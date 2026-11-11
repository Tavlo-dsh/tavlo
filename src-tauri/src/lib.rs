//! Tavlo：Tauri 壳 + 本机环境中的 `dsh web`。
//!
//! 启动顺序：主窗口显示 splash → 在本机环境定位 dsh 并读取版本 → `dsh web --no-open --port 0`
//! → 解析 stdout 的 `dsh web: <url>` 就绪行 → 主窗口导航到该 URL（token 换 cookie 由 dsh 完成）。
//! 失败或 dsh 退出时显示本地错误页，可在页面或托盘中重启 dsh。
//!
//! 安全边界：dsh 页面是 loopback 远程内容，不授予任何 Tauri IPC（capabilities 无 remote）；
//! 只有本地打包页面（splash / 错误页）能调用 `restart_dsh` / `open_log_dir` 两个无参命令。

mod dsh_locate;
mod dsh_process;
mod dsh_web;
mod page_theme;
mod portable;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use dsh_process::DshProcess;
use dsh_web::{navigation_decision, parse_ready_line, redact_token, NavigationDecision};
use portable::DataLayout;
use serde_json::json;
use std::collections::VecDeque;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const MAIN: &str = "main";
const TAIL_LINES: usize = 40;
const VERSION_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Runtime {
    process: Option<DshProcess>,
    version: Option<String>,
    launcher: Option<String>,
    ready: bool,
    tail: VecDeque<String>,
}

struct Shell {
    generation: AtomicU64,
    quitting: AtomicBool,
    runtime: Mutex<Runtime>,
    /// 本地打包页面的根地址，splash 首次加载完成时记录（dev 与生产不同）。
    app_base: Mutex<Option<Url>>,
    /// splash 加载完成前就发生的失败，等页面就绪后再显示。
    pending_failure: Mutex<Option<String>>,
    status: Mutex<String>,
    log: Mutex<Option<File>>,
    layout: DataLayout,
}

impl Shell {
    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation && !self.quitting.load(Ordering::SeqCst)
    }

    fn log_line(&self, stream: &str, line: &str) {
        if let Ok(mut guard) = self.log.lock() {
            if let Some(file) = guard.as_mut() {
                let _ = writeln!(file, "[{stream}] {}", redact_token(line));
            }
        }
    }

    fn open_log(&self) {
        let dir = &self.layout.log_dir;
        let _ = std::fs::create_dir_all(dir);
        let current = dir.join("dsh-web.log");
        let _ = std::fs::rename(&current, dir.join("dsh-web.prev.log"));
        if let Ok(mut guard) = self.log.lock() {
            *guard = File::create(&current).ok();
        }
    }

    fn kill_process(&self) {
        let process = self.runtime.lock().ok().and_then(|mut runtime| runtime.process.take());
        if let Some(mut process) = process {
            process.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![restart_dsh, open_log_dir])
        .setup(|app| {
            let exe_dir = std::env::current_exe().ok().and_then(|exe| exe.parent().map(PathBuf::from));
            let default_log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("tavlo-logs"));
            let layout = portable::resolve_layout(exe_dir.as_deref(), default_log_dir);
            app.manage(Shell {
                generation: AtomicU64::new(0),
                quitting: AtomicBool::new(false),
                runtime: Mutex::new(Runtime::default()),
                app_base: Mutex::new(None),
                pending_failure: Mutex::new(None),
                status: Mutex::new(String::new()),
                log: Mutex::new(None),
                layout,
            });

            create_main_window(app)?;
            start_theme_sync(app.handle().clone());
            build_tray(app)?;
            start_dsh(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Tavlo")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(shell) = app.try_state::<Shell>() {
                    shell.quitting.store(true, Ordering::SeqCst);
                    shell.kill_process();
                }
            }
        });
}

fn create_main_window(app: &tauri::App) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN)
        .cloned()
        .expect("main window config");
    let nav_app = app.handle().clone();
    let popup_app = app.handle().clone();
    let mut builder = WebviewWindowBuilder::from_config(app.handle(), &config)?
        .visible(false)
        .background_color(tauri::window::Color(0x12, 0x12, 0x14, 255))
        .on_navigation(move |url| match navigation_decision(url) {
            NavigationDecision::Allow => true,
            NavigationDecision::OpenExternal => {
                let _ = nav_app.opener().open_url(url.as_str(), None::<&str>);
                false
            }
            NavigationDecision::Deny => false,
        })
        .on_new_window(move |url, _features| match navigation_decision(&url) {
            NavigationDecision::Allow => NewWindowResponse::Allow,
            NavigationDecision::OpenExternal => {
                let _ = popup_app.opener().open_url(url.as_str(), None::<&str>);
                NewWindowResponse::Deny
            }
            NavigationDecision::Deny => NewWindowResponse::Deny,
        })
        .on_page_load(|window, payload| {
            if payload.event() != PageLoadEvent::Finished || !payload.url().path().ends_with("/splash.html") {
                return;
            }
            let app = window.app_handle();
            let shell = app.state::<Shell>();
            if let Ok(mut base) = shell.app_base.lock() {
                *base = payload.url().join("./").ok();
            }
            let pending = shell.pending_failure.lock().ok().and_then(|mut pending| pending.take());
            if let Some(encoded) = pending {
                show_failure_page(app, &encoded);
                return;
            }
            let status = shell.status.lock().map(|s| s.clone()).unwrap_or_default();
            push_status(&window, &status);
        });
    if let Some(dir) = app.state::<Shell>().layout.webview_dir.clone() {
        builder = builder.data_directory(dir);
    }
    let window = builder.build()?;
    let background = if window.theme()? == tauri::Theme::Dark {
        tauri::window::Color(0x12, 0x12, 0x14, 255)
    } else {
        tauri::window::Color(255, 255, 255, 255)
    };
    window.set_background_color(Some(background))?;

    let close_app = app.handle().clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { .. } = event {
            quit(&close_app);
        }
    });
    window.show()?;
    Ok(window)
}

/// 原生端主动读取颜色，不让远程 DSH 页面调用任何壳命令。
fn start_theme_sync(app: AppHandle) {
    std::thread::spawn(move || {
        let mut reported_error = false;
        while !app.state::<Shell>().quitting.load(Ordering::SeqCst) {
            let Some(window) = app.get_webview_window(MAIN) else { break };
            if let Ok(url) = window.url() {
                let (tx, rx) = std::sync::mpsc::channel();
                if window.eval_with_callback(include_str!("read-page-theme.js"), move |value| {
                    let _ = tx.send(value);
                }).is_ok() {
                    if let Ok(value) = rx.recv_timeout(Duration::from_secs(1)) {
                        // 导航期间返回的旧页面结果不能覆盖新页面主题。
                        if window.url().is_ok_and(|current| current == url) {
                            if let Some(scheme) = page_theme::from_eval_result(&value) {
                                match apply_frame_theme(&window, scheme) {
                                    Ok(()) => reported_error = false,
                                    Err(error) if !reported_error => {
                                        app.state::<Shell>().log_line("shell", &format!("theme sync: {error}"));
                                        reported_error = true;
                                    }
                                    Err(_) => {}
                                }
                            }
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    });
}

#[cfg(windows)]
fn apply_frame_theme(window: &WebviewWindow, scheme: page_theme::ColorScheme) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as _;
    let dark = i32::from(scheme == page_theme::ColorScheme::Dark);
    let mut current = 0_i32;
    // 只改变原生标题栏；不调用 set_theme 改写 WebView 的系统配色偏好。
    unsafe {
        let status = DwmGetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            &mut current as *mut _ as _, std::mem::size_of_val(&current) as u32);
        if status >= 0 && (current != 0) == (dark != 0) {
            return Ok(());
        }
        let status = DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            &dark as *const _ as _, std::mem::size_of_val(&dark) as u32);
        if status < 0 {
            return Err(format!("DwmSetWindowAttribute failed: {status:#x}"));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_frame_theme(window: &WebviewWindow, scheme: page_theme::ColorScheme) -> Result<(), String> {
    let theme = match scheme {
        page_theme::ColorScheme::Light => tauri::Theme::Light,
        page_theme::ColorScheme::Dark => tauri::Theme::Dark,
    };
    window.set_theme(Some(theme)).map_err(|error| error.to_string())
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
    let restart = MenuItemBuilder::with_id("restart", "重启 DSH").build(app)?;
    let logs = MenuItemBuilder::with_id("logs", "打开日志目录").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&show, &restart, &logs])
        .item(&PredefinedMenuItem::separator(app)?)
        .item(&quit_item)
        .build()?;
    let mut tray = TrayIconBuilder::with_id(MAIN)
        .tooltip("Tavlo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => reveal_main_window(app),
            "restart" => start_dsh(app.clone()),
            "logs" => open_logs(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                reveal_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
fn restart_dsh(app: AppHandle) {
    start_dsh(app);
}

#[tauri::command]
fn open_log_dir(app: AppHandle) {
    open_logs(&app);
}

fn open_logs(app: &AppHandle) {
    let dir = app.state::<Shell>().layout.log_dir.clone();
    let _ = std::fs::create_dir_all(&dir);
    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
}

fn quit(app: &AppHandle) {
    let shell = app.state::<Shell>();
    shell.quitting.store(true, Ordering::SeqCst);
    shell.kill_process();
    app.exit(0);
}

fn reveal_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn app_page(app: &AppHandle, page: &str) -> Option<Url> {
    let base = app.state::<Shell>().app_base.lock().ok()?.clone()?;
    base.join(page).ok()
}

fn push_status(window: &WebviewWindow, status: &str) {
    if status.is_empty() {
        return;
    }
    let payload = serde_json::to_string(status).unwrap_or_default();
    let _ = window.eval(format!("window.dshSplash && window.dshSplash.status({payload})"));
}

fn set_status(app: &AppHandle, status: &str) {
    if let Ok(mut current) = app.state::<Shell>().status.lock() {
        *current = status.to_string();
    }
    if let Some(window) = app.get_webview_window(MAIN) {
        push_status(&window, status);
    }
}

/// （重新）启动 dsh：结束旧进程，显示 splash，后台线程完成定位与启动。
fn start_dsh(app: AppHandle) {
    let shell = app.state::<Shell>();
    if shell.quitting.load(Ordering::SeqCst) {
        return;
    }
    let generation = shell.generation.fetch_add(1, Ordering::SeqCst) + 1;
    shell.kill_process();
    if let Ok(mut runtime) = shell.runtime.lock() {
        runtime.ready = false;
        runtime.tail.clear();
    }
    if let Ok(mut status) = shell.status.lock() {
        status.clear();
    }
    if let Ok(mut pending) = shell.pending_failure.lock() {
        pending.take();
    }
    if let (Some(window), Some(splash)) = (app.get_webview_window(MAIN), app_page(&app, "splash.html")) {
        let _ = window.navigate(splash);
    }
    std::thread::spawn(move || launch(app, generation));
}

struct Failure {
    title: String,
    detail: String,
    hint: Option<String>,
    exit_code: Option<i32>,
}

fn launch(app: AppHandle, generation: u64) {
    let shell = app.state::<Shell>();
    shell.open_log();
    set_status(&app, "正在查找本机的 dsh…");

    let launcher = match dsh_locate::locate(std::env::var_os("DSH_BIN"), std::env::var_os("PATH")) {
        Ok(launcher) => launcher,
        Err(error) => {
            let hint = match error {
                dsh_locate::LocateError::NodeMissing(_) => "请安装 Node.js（≥ 24.9）并确保 node 在 PATH 中。",
                _ => "请先安装：npm i -g @deepseek-ai/dsh（需要 Node.js ≥ 24.9），或设置环境变量 DSH_BIN 指向 dsh。",
            };
            return fail(&app, generation, Failure {
                title: "没有找到 dsh".into(),
                detail: error.to_string(),
                hint: Some(hint.into()),
                exit_code: None,
            });
        }
    };
    let launcher_text = format!(
        "{} {}",
        launcher.program.display(),
        launcher.prefix_args.iter().map(|arg| arg.to_string_lossy()).collect::<Vec<_>>().join(" ")
    )
    .trim()
    .to_string();
    shell.log_line("shell", &format!("dsh found at {} -> {launcher_text}", launcher.found_at.display()));
    if let Ok(mut runtime) = shell.runtime.lock() {
        runtime.launcher = Some(launcher.found_at.display().to_string());
    }

    let cwd = app.path().home_dir().unwrap_or_else(|_| std::env::temp_dir());
    set_status(&app, "正在检测 dsh 版本…");
    let version = match dsh_process::query_version(&launcher, &cwd, VERSION_TIMEOUT) {
        Ok(output) => match dsh_web::parse_version(&output) {
            Some(version) => version,
            None => {
                return fail(&app, generation, Failure {
                    title: "无法识别 dsh 版本".into(),
                    detail: format!("dsh --version 输出：{}", output.trim()),
                    hint: None,
                    exit_code: None,
                })
            }
        },
        Err(error) => {
            return fail(&app, generation, Failure {
                title: "dsh 无法运行".into(),
                detail: error.to_string(),
                hint: Some("dsh 需要 Node.js ≥ 24.9，可在终端执行 dsh --version 排查。".into()),
                exit_code: None,
            })
        }
    };
    shell.log_line("shell", &format!("dsh version {version}"));
    if let Ok(mut runtime) = shell.runtime.lock() {
        runtime.version = Some(version.clone());
    }
    if !shell.is_current(generation) {
        return;
    }

    set_status(&app, &format!("正在启动 dsh {version} …"));
    let mut process = match DshProcess::spawn(&launcher, &cwd) {
        Ok(process) => process,
        Err(error) => {
            return fail(&app, generation, Failure {
                title: "dsh web 启动失败".into(),
                detail: error.to_string(),
                hint: None,
                exit_code: None,
            })
        }
    };
    let stdout = process.take_stdout();
    let stderr = process.take_stderr();
    {
        let mut runtime = shell.runtime.lock().unwrap();
        if !shell.is_current(generation) {
            drop(runtime);
            process.kill();
            return;
        }
        runtime.process = Some(process);
    }

    if let Some(stdout) = stdout {
        let app = app.clone();
        std::thread::spawn(move || {
            for_each_line(stdout, |line| on_stdout(&app, generation, line));
        });
    }
    if let Some(stderr) = stderr {
        let app = app.clone();
        std::thread::spawn(move || {
            for_each_line(stderr, |line| {
                let shell = app.state::<Shell>();
                shell.log_line("err", line);
                push_tail(&shell, line);
            });
        });
    }

    // 监视进程退出。
    loop {
        std::thread::sleep(Duration::from_millis(300));
        if !shell.is_current(generation) {
            return;
        }
        let status = {
            let mut runtime = shell.runtime.lock().unwrap();
            match runtime.process.as_mut().map(|process| process.try_wait()) {
                Some(Ok(Some(status))) => Some(status),
                Some(Ok(None)) => None,
                Some(Err(_)) | None => return,
            }
        };
        if let Some(status) = status {
            // 让输出线程把最后几行写进 tail。
            std::thread::sleep(Duration::from_millis(200));
            let ready = shell.runtime.lock().map(|runtime| runtime.ready).unwrap_or(false);
            shell.log_line("shell", &format!("dsh exited: {status}"));
            return fail(&app, generation, Failure {
                title: if ready { "dsh 已意外退出".into() } else { "dsh web 没能启动".into() },
                detail: format!("进程退出：{status}"),
                hint: None,
                exit_code: status.code(),
            });
        }
    }
}

fn on_stdout(app: &AppHandle, generation: u64, line: &str) {
    let shell = app.state::<Shell>();
    shell.log_line("out", line);
    let Some(url) = parse_ready_line(line) else {
        push_tail(&shell, line);
        return;
    };
    if !shell.is_current(generation) {
        return;
    }
    {
        let mut runtime = shell.runtime.lock().unwrap();
        if runtime.ready {
            return;
        }
        runtime.ready = true;
    }
    shell.log_line("shell", &format!("ready at {}", url.origin().ascii_serialization()));
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.navigate(url);
    }
}

fn push_tail(shell: &Shell, line: &str) {
    if let Ok(mut runtime) = shell.runtime.lock() {
        runtime.tail.push_back(redact_token(&dsh_web::strip_ansi(line)));
        while runtime.tail.len() > TAIL_LINES {
            runtime.tail.pop_front();
        }
    }
}

fn for_each_line(reader: impl Read, mut f: impl FnMut(&str)) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                let line = String::from_utf8_lossy(&buf);
                f(line.trim_end_matches(['\r', '\n']));
            }
        }
    }
}

fn fail(app: &AppHandle, generation: u64, failure: Failure) {
    let shell = app.state::<Shell>();
    if !shell.is_current(generation) {
        return;
    }
    shell.log_line("shell", &format!("failure: {} — {}", failure.title, failure.detail));
    let (version, launcher, tail) = shell
        .runtime
        .lock()
        .map(|runtime| {
            (
                runtime.version.clone(),
                runtime.launcher.clone(),
                runtime.tail.iter().cloned().collect::<Vec<_>>().join("\n"),
            )
        })
        .unwrap_or_default();
    let payload = json!({
        "title": failure.title,
        "detail": failure.detail,
        "hint": failure.hint,
        "exitCode": failure.exit_code,
        "version": version,
        "launcher": launcher,
        "output": tail,
        "logDir": shell.layout.log_dir.display().to_string(),
        "portable": shell.layout.portable,
    });
    let encoded = URL_SAFE_NO_PAD.encode(payload.to_string());
    if app_page(app, "launch-error.html").is_some() {
        show_failure_page(app, &encoded);
    } else {
        if let Ok(mut pending) = shell.pending_failure.lock() {
            *pending = Some(encoded);
        }
        // splash 可能恰好在上面两步之间加载完成：再检查一次，避免待显示的失败无人取走。
        if app_page(app, "launch-error.html").is_some() {
            let pending = shell.pending_failure.lock().ok().and_then(|mut pending| pending.take());
            if let Some(encoded) = pending {
                show_failure_page(app, &encoded);
            }
        }
    }
}

fn show_failure_page(app: &AppHandle, encoded: &str) {
    if let (Some(window), Some(mut page)) = (app.get_webview_window(MAIN), app_page(app, "launch-error.html")) {
        page.set_fragment(Some(encoded));
        let _ = window.navigate(page);
        let _ = window.show();
    }
}
