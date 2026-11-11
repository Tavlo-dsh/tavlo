mod app_menu;
mod bootstrap;
mod composer_surfaces;
mod dialog;
mod host_process;
#[cfg(target_os = "macos")]
mod macos_chrome;
mod main_view_theme;
mod materials;
mod native_effects;
mod profile;
mod profile_create;
mod protocol;
mod recovery;
mod renderer_proxy;
mod settings_conflict_retry;
mod settings_fullscreen;
mod tray_locale;
mod user_data;
mod volume_admission;
mod window_ops;
mod window_spec;
mod zip_store;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use protocol::{decode_message, encode_message, err_result, ok_result, RpcMessage, PROTOCOL_VERSION};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex};
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use std::time::Duration;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use native_effects::NativeSession;
use tray_locale::{tray_menu_plan, TrayPlanEntry};
use window_ops::{
    apply_zoom_delta, fit_main_window_bounds, folder_drop_script, macos_traffic_light_wry_inset_y,
    next_window_maximized, open_external_href, persist_window_bounds, same_window_bounds,
    FullscreenHideState, LeaveFullscreenAction, ClosePlan, ShowAction, WindowBounds, FILE_PATH_BRIDGE_SCRIPT,
    MACOS_TRAFFIC_LIGHT_X, TITLEBAR_DBLCLICK_SCRIPT, ZOOM_SHORTCUT_SCRIPT,
};
#[cfg(target_os = "macos")]
use window_ops::application_needs_reveal;
use window_spec::{chrome_for_mode, ShellPayload};
use settings_fullscreen::SETTINGS_FULLSCREEN_SCRIPT;
use main_view_theme::MAIN_VIEW_THEME_SCRIPT;
use composer_surfaces::COMPOSER_SURFACES_SCRIPT;
use settings_conflict_retry::SETTINGS_CONFLICT_RETRY_SCRIPT;

const BOUNDS_DEBOUNCE_MS: u64 = 250;

struct AppState {
    generation: Mutex<Option<String>>,
    host_stdin: Mutex<Option<std::process::ChildStdin>>,
    payload: Mutex<Option<ShellPayload>>,
    renderer_proxy: Mutex<Option<renderer_proxy::RendererProxy>>,
    quitting: AtomicBool,
    restart_recovery: AtomicBool,
    session: Mutex<NativeSession>,
    bounds_event_seq: AtomicU64,
    bounds_flush_pending: AtomicBool,
    fullscreen: Mutex<FullscreenHideState>,
    tray_locale: Mutex<String>,
    app_menu_revision: AtomicU64,
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            reveal_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            open_external,
            toggle_maximize,
            zoom_change
        ])
        .manage(AppState {
            generation: Mutex::new(None),
            host_stdin: Mutex::new(None),
            payload: Mutex::new(None),
            renderer_proxy: Mutex::new(None),
            quitting: AtomicBool::new(false),
            restart_recovery: AtomicBool::new(false),
            session: Mutex::new(NativeSession::new(
                user_data::desktop_user_data_dir(),
                current_platform(),
            )),
            bounds_event_seq: AtomicU64::new(0),
            bounds_flush_pending: AtomicBool::new(false),
            fullscreen: Mutex::new(FullscreenHideState::default()),
            tray_locale: Mutex::new("en".to_string()),
            app_menu_revision: AtomicU64::new(0),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let user_data = user_data::desktop_user_data_dir();
            let _bootstrap = bootstrap::load_native_bootstrap(&user_data);
            let _profile = profile::load_profile_state(&user_data.join("profile-selection").join("state.json"));
            // macOS tao panics in did_finish_launching if the last window is closed during setup.
            // Create main before spawning Host so shell.mount cannot race a missing window.
            let window = create_main_window(app)?;
            bind_main_window_events(&window, handle.clone());
            let _tray = TrayIconBuilder::with_id("main")
                .show_menu_on_left_click(false)
                .on_menu_event(handle_menu_event)
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { .. }) {
                        reveal_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            rebuild_tray_menu(app.handle());
            spawn_host_bridge(handle.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running DSH Desktop")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                handle_macos_reopen(app, has_visible_windows);
            }
        });
}

fn reveal_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    let _ = window.show();
    let _ = window.set_focus();
    clear_attention(app);
    if let Ok(mut fullscreen) = app
        .try_state::<AppState>()
        .expect("app state")
        .fullscreen
        .lock()
    {
        if fullscreen.on_show() == ShowAction::EnterFullscreen {
            let _ = window.set_fullscreen(true);
        }
    }
}

fn clear_attention(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let cleared = state
        .session
        .lock()
        .map(|mut session| session.clear_attention())
        .unwrap_or(false);
    if !cleared {
        return;
    }
    apply_attention_state(app, 0);
}

fn apply_attention_state(app: &AppHandle, attention: u32) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.run_on_main_thread(move || {
            if let Some(mtm) = objc2::MainThreadMarker::new() {
                macos_chrome::set_dock_badge(mtm, attention);
            }
        });
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            flash_frame(&window, attention > 0);
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        let _ = attention;
    }
}

#[cfg(target_os = "windows")]
fn flash_frame(window: &tauri::WebviewWindow, start: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FlashWindow, FLASHWINFO, FLASHW_ALL, FLASHW_STOP,
    };
    let Ok(hwnd) = window.hwnd().map(|value| value.0 as isize) else {
        return;
    };
    let mut info = FLASHWINFO {
        cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
        hwnd: hwnd as *mut _,
        dwFlags: if start { FLASHW_ALL } else { FLASHW_STOP },
        uCount: if start { u32::MAX } else { 0 },
        dwTimeout: 0,
    };
    unsafe {
        FlashWindow(&mut info);
    }
}

#[cfg(target_os = "macos")]
fn handle_macos_reopen(app: &AppHandle, has_visible_windows: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    if application_needs_reveal(visible, minimized, !has_visible_windows, current_platform()) {
        reveal_main_window(app);
    }
}

const EXTERNAL_LINK_CLICK_SCRIPT: &str = r#"document.addEventListener('click', (event) => {
  const node = event.target && event.target.closest && event.target.closest('a[href]');
  if (!node) return;
  const href = node.href || '';
  const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (typeof invoke !== 'function') return;
  try {
    const target = new URL(href, location.href);
    const loopback = target.hostname === '127.0.0.1' || target.hostname === 'localhost' || target.hostname === '[::1]';
    const external = target.protocol === 'mailto:' || ((target.protocol === 'http:' || target.protocol === 'https:') && !loopback);
    if (!external) return;
    event.preventDefault();
    invoke('open_external', { origin: location.origin, href: target.href });
  } catch (error) {}
}, true);"#;

fn create_main_window(app: &tauri::App) -> tauri::Result<tauri::WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .expect("main window config");
    let nav_handle = app.handle().clone();
    let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
        // The desktop main view is pinned to the dark product form; the native
        // titlebar material must follow the web palette instead of the system
        // appearance. The background color shows through the transparent
        // desktop-frame titlebar strip (web body is transparent above #root).
        .theme(Some(tauri::Theme::Dark))
        .background_color(tauri::window::Color(0x16, 0x16, 0x16, 255))
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition {
            x: MACOS_TRAFFIC_LIGHT_X,
            y: macos_traffic_light_wry_inset_y(chrome_for_mode("compatibility").titlebar_height),
        }))
        .on_navigation(move |url| {
            let href = url.as_str().to_string();
            let origin = nav_handle
                .try_state::<AppState>()
                .and_then(|state| {
                    state
                        .payload
                        .lock()
                        .ok()
                        .and_then(|payload| payload.as_ref().map(|item| item.url.clone()))
                })
                .unwrap_or_else(|| href.clone());
            let decision = open_external_href(&origin, &href, |target| {
                nav_handle
                    .opener()
                    .open_url(target, None::<&str>)
                    .map_err(|error| error.to_string())
            });
            match decision {
                Ok(true) => false,
                _ => true,
            }
        })
        .on_page_load(|window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let _ = window.eval(EXTERNAL_LINK_CLICK_SCRIPT);
            let _ = window.eval(TITLEBAR_DBLCLICK_SCRIPT);
            let _ = window.eval(ZOOM_SHORTCUT_SCRIPT);
            let _ = window.eval(FILE_PATH_BRIDGE_SCRIPT);
            let _ = window.eval(SETTINGS_FULLSCREEN_SCRIPT);
            let _ = window.eval(MAIN_VIEW_THEME_SCRIPT);
            let _ = window.eval(COMPOSER_SURFACES_SCRIPT);
            let _ = window.eval(SETTINGS_CONFLICT_RETRY_SCRIPT);
        })
        .build()?;
    apply_traffic_light_chrome(&window, chrome_for_mode("compatibility").titlebar_height);
    Ok(window)
}

fn apply_traffic_light_chrome(window: &tauri::WebviewWindow, titlebar_height: u32) {
    #[cfg(target_os = "macos")]
    macos_chrome::apply_traffic_lights(window, titlebar_height);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, titlebar_height);
    }
}

fn bind_main_window_events(window: &tauri::WebviewWindow, app_handle: AppHandle) {
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            let Some(state) = app_handle.try_state::<AppState>() else {
                return;
            };
            let quitting = state.quitting.load(Ordering::SeqCst);
            let Some(window) = app_handle.get_webview_window("main") else {
                return;
            };
            let is_fullscreen = window.is_fullscreen().unwrap_or(false);
            let plan = state
                .fullscreen
                .lock()
                .map(|mut fullscreen| fullscreen.on_close(is_fullscreen, quitting))
                .unwrap_or(ClosePlan::Hide);
            match plan {
                ClosePlan::AllowClose => {
                    flush_window_bounds(&app_handle);
                }
                ClosePlan::Hide => {
                    api.prevent_close();
                    flush_window_bounds(&app_handle);
                    let _ = window.hide();
                }
                ClosePlan::ExitFullscreenThenHide | ClosePlan::WaitForFullscreenExit => {
                    api.prevent_close();
                    flush_window_bounds(&app_handle);
                    let _ = window.set_fullscreen(false);
                    // The Resized event that follows the fullscreen exit applies
                    // the pending hide (or the flipped re-fullscreen).
                }
            }
        }
        WindowEvent::Focused(focused) => {
            if let Some(state) = app_handle.try_state::<AppState>() {
                if let Ok(mut session) = state.session.lock() {
                    session.focused = *focused;
                }
            }
            if *focused {
                clear_attention(&app_handle);
            }
        }
        WindowEvent::DragDrop(DragDropEvent::Drop { paths, position }) => {
            let list = paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect::<Vec<_>>();
            let script = folder_drop_script(&list, position.x, position.y);
            if let Some(state) = app_handle.try_state::<AppState>() {
                if let Ok(mut session) = state.session.lock() {
                    session.last_drop_script = Some(script.clone());
                }
            }
            let _ = app_handle.emit("dsh-desktop-folder-drop", json!({ "paths": list }));
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.eval(&script);
            }
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let Some(window) = app_handle.get_webview_window("main") else {
                return;
            };
            if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
                let bounds = WindowBounds {
                    x: pos.x,
                    y: pos.y,
                    width: size.width,
                    height: size.height,
                };
                let mut titlebar_height = chrome_for_mode("compatibility").titlebar_height;
                if let Some(state) = app_handle.try_state::<AppState>() {
                    if let Ok(mut session) = state.session.lock() {
                        session.bounds = Some(bounds);
                        if let Some(plan) = session.last_plan.as_ref() {
                            titlebar_height = plan.chrome.titlebar_height;
                        }
                    }
                    // A fullscreen exit completes with a Resized event: apply the
                    // pending hide / re-fullscreen from the state machine.
                    if matches!(event, WindowEvent::Resized(_)) {
                        let exited_fullscreen = !window.is_fullscreen().unwrap_or(false);
                        let mut fullscreen = state.fullscreen.lock().expect("fullscreen state");
                        if exited_fullscreen && fullscreen.fullscreen_exit_pending {
                            match fullscreen.on_leave_fullscreen() {
                                LeaveFullscreenAction::Hide => {
                                    let _ = window.hide();
                                }
                                LeaveFullscreenAction::Refullscreen => {
                                    let _ = window.set_fullscreen(true);
                                }
                                LeaveFullscreenAction::None => {}
                            }
                        }
                    }
                    schedule_bounds_flush(&app_handle);
                }
                if matches!(event, WindowEvent::Resized(_)) {
                    apply_traffic_light_chrome(&window, titlebar_height);
                }
            }
        }
        _ => {}
    });
}

/// Debounce window-geometry writes: collapse bursts of Moved/Resized events
/// into one persist 250ms after the last event (upstream contract).
fn schedule_bounds_flush(app_handle: &AppHandle) {
    let Some(state) = app_handle.try_state::<AppState>() else {
        return;
    };
    let seq = state.bounds_event_seq.fetch_add(1, Ordering::SeqCst) + 1;
    if state.bounds_flush_pending.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app_handle.clone();
    std::thread::spawn(move || {
        let state = match app.try_state::<AppState>() {
            Some(state) => state,
            None => return,
        };
        let mut observed = seq;
        loop {
            std::thread::sleep(Duration::from_millis(BOUNDS_DEBOUNCE_MS));
            let latest = state.bounds_event_seq.load(Ordering::SeqCst);
            if latest == observed {
                break;
            }
            observed = latest;
        }
        state.bounds_flush_pending.store(false, Ordering::SeqCst);
        let flush_handle = app.clone();
        let _ = run_on_main_thread(&app, move || {
            flush_window_bounds(&flush_handle);
        });
    });
}

/// Persist the current window rectangle unless maximized (upstream keeps the
/// normal bounds, never the maximized frame).
fn flush_window_bounds(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_maximized().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let bounds = WindowBounds {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
    };
    let mut session = match state.session.lock() {
        Ok(session) => session,
        Err(_) => return,
    };
    if let Some(previous) = &session.persisted_bounds {
        if same_window_bounds(previous, &bounds) {
            return;
        }
    }
    if persist_window_bounds(&session.user_data, &bounds).is_ok() {
        session.persisted_bounds = Some(bounds);
    }
}

#[tauri::command]
fn toggle_maximize(window: tauri::WebviewWindow) -> Result<bool, String> {
    let maximized = window
        .is_maximized()
        .map_err(|error| error.to_string())?;
    if next_window_maximized(maximized) {
        window.maximize().map_err(|error| error.to_string())?;
        Ok(true)
    } else {
        window.unmaximize().map_err(|error| error.to_string())?;
        Ok(false)
    }
}

#[tauri::command]
fn zoom_change(app: AppHandle, window: tauri::WebviewWindow, delta: i32) -> Result<i32, String> {
    let state = app.state::<AppState>();
    let next = {
        let mut session = state.session.lock().map_err(|error| error.to_string())?;
        let next = if delta == 0 {
            0
        } else {
            apply_zoom_delta(session.zoom_level, delta)
        };
        session.zoom_level = next;
        next
    };
    let zoom = 1.0 + f64::from(next) * 0.1;
    window
        .eval(&format!("document.documentElement.style.zoom = '{zoom}'"))
        .map_err(|error| error.to_string())?;
    Ok(next)
}

#[tauri::command]
fn open_external(app: AppHandle, origin: String, href: String) -> Result<bool, String> {
    open_external_href(&origin, &href, |url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|error| error.to_string())
    })
}

fn run_on_main_thread<T: Send + 'static>(
    app: &AppHandle,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(work());
    })
    .map_err(|error| error.to_string())?;
    rx.recv_timeout(Duration::from_secs(30))
        .map_err(|error| error.to_string())
}

fn spawn_host_bridge(app: AppHandle) {
    std::thread::spawn(move || {
        let user_data = user_data::desktop_user_data_dir();
        let resource_dir = app.path().resource_dir().ok();
        let recovery = app
            .try_state::<AppState>()
            .map(|state| state.restart_recovery.load(Ordering::SeqCst))
            .unwrap_or(false);
        let entry = host_process::host_entry_path_from(resource_dir.as_deref());
        if !entry.exists() {
            let _ = open_recovery_window(
                &app,
                json!({
                    "failureStage": "runtime-bootstrap",
                    "failureDetail": format!("Host entry is missing: {}", entry.display()),
                }),
            );
            return;
        }
        let mut child = match host_process::spawn_host(&entry, &user_data, recovery, resource_dir.as_deref()) {
            Ok(child) => child,
            Err(error) => {
                let _ = open_recovery_window(
                    &app,
                    json!({
                        "failureStage": "host-boot",
                        "failureDetail": error.to_string(),
                    }),
                );
                return;
            }
        };
        if let Some(stdin) = host_process::take_stdin(&mut child) {
            if let Some(state) = app.try_state::<AppState>() {
                *state.host_stdin.lock().expect("stdin lock") = Some(stdin);
            }
        }
        let stdout = child.stdout.take().expect("host stdout");
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            match decode_message(&line) {
                Ok(RpcMessage::Request { id, method, params, .. }) => {
                    let result = handle_host_request(&app, &method, params.unwrap_or(Value::Null));
                    let reply = match result {
                        Ok(value) => ok_result(id, value),
                        Err(message) => err_result(id, message),
                    };
                    write_to_host(&app, &reply);
                }
                Ok(RpcMessage::Event { method, params, .. }) => {
                    if method == "event.sidecarFailed" {
                        let _ = open_recovery_window(&app, params.unwrap_or(Value::Null));
                    } else if method.starts_with("shell.") {
                        let _ = handle_host_request(&app, &method, params.unwrap_or(Value::Null));
                    }
                }
                Err(error) => eprintln!("dsh-desktop: {error}"),
                _ => {}
            }
        }
    });
}

fn write_to_host(app: &AppHandle, message: &RpcMessage) {
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut stdin) = state.host_stdin.lock() {
            if let Some(stdin) = stdin.as_mut() {
                if let Ok(encoded) = encode_message(message) {
                    let _ = stdin.write_all(encoded.as_bytes());
                    let _ = stdin.flush();
                }
            }
        }
    }
}

fn current_tray_locale(app: &AppHandle) -> String {
    app.try_state::<AppState>()
        .and_then(|state| state.tray_locale.lock().ok().map(|locale| locale.clone()))
        .unwrap_or_else(|| "en".to_string())
}

fn current_product_name(app: &AppHandle) -> String {
    app.try_state::<AppState>()
        .and_then(|state| {
            state
                .payload
                .lock()
                .ok()
                .and_then(|payload| payload.as_ref().map(|item| item.product_name.clone()))
        })
        .unwrap_or_else(|| "DSH Desktop".to_string())
}

/// Start the renderer proxy for a scheduled generation and return the URL the
/// webview should load. Falls back to the carrier URL when the generation
/// carries no renderer capability (placeholder Host) or the proxy cannot bind.
fn mount_renderer_proxy(state: &AppState, payload: &ShellPayload) -> String {
    let Some(header) = payload.renderer_access_header.clone() else {
        return payload.url.clone();
    };
    let Ok(carrier) = url::Url::parse(&payload.url) else {
        return payload.url.clone();
    };
    match tauri::async_runtime::block_on(renderer_proxy::RendererProxy::start(carrier, header)) {
        Ok(proxy) => {
            let webview_url = proxy
                .webview_url(&url::Url::parse(&payload.url).expect("carrier url parsed twice"))
                .to_string();
            eprintln!("dsh-desktop: renderer proxy mounted, webview url: {webview_url}");
            *state.renderer_proxy.lock().expect("renderer proxy") = Some(proxy);
            webview_url
        }
        Err(error) => {
            eprintln!(
                "dsh-desktop: renderer proxy unavailable, loading carrier directly: {error}"
            );
            payload.url.clone()
        }
    }
}

fn handle_host_request(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {    let state = app.state::<AppState>();
    let result = {
        let mut session = state.session.lock().expect("session");
        session.dispatch(method, params.clone())?
    };
    match method {
        "shell.schedule" => {
            if let Some(id) = result.get("generationId").and_then(Value::as_str) {
                *state.generation.lock().expect("generation") = Some(id.to_string());
            }
            if let Ok(mut payload) = serde_json::from_value::<ShellPayload>(params.clone()) {
                payload.url = mount_renderer_proxy(&state, &payload);
                *state.payload.lock().expect("payload") = Some(payload);
            }
        }
        "shell.mount" => {
            let payload = state
                .payload
                .lock()
                .expect("payload")
                .clone()
                .ok_or_else(|| "no scheduled generation".to_string())?;
            let handle = app.clone();
            run_on_main_thread(app, move || mount_main_window(&handle, &payload))??;
        }
        "shell.release" => {
            *state.generation.lock().expect("generation") = None;
            *state.renderer_proxy.lock().expect("renderer proxy") = None;
            *state.payload.lock().expect("payload") = None;
        }
        "shell.show" => reveal_main_window(app),
        "shell.openRecovery" => {
            if params.get("href").is_none() {
                open_recovery_window(app, params.get("state").cloned().unwrap_or(params))?;
            }
        }
        "shell.openDialog" => {
            if params.get("href").is_none() {
                return open_dialog_window(app, params);
            }
        }
        "shell.openProfileCreate" => {
            if params.get("name").is_none() {
                let locale = current_tray_locale(app);
                let handle = app.clone();
                let _ = run_on_main_thread(app, move || {
                    open_profile_create_window(&handle, &locale)
                })?;
            }
        }
        "shell.openDevtools" => {
            if let Some(url) = result.get("url").and_then(Value::as_str) {
                open_devtools_window(app, url)?;
            }
        }
        "shell.reloadRenderer" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("location.reload()");
            }
        }
        "shell.toggleDeveloperTools" => {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_devtools_open() {
                    let _ = window.close_devtools();
                } else {
                    window.open_devtools();
                }
            }
        }
        "shell.pickDirectory" => {
            if params.get("path").is_none() {
                let title = params
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Select Workspace Directory")
                    .to_string();
                let folder = tauri_plugin_dialog::DialogExt::dialog(app)
                    .file()
                    .set_title(&title)
                    .blocking_pick_folder();
                return Ok(json!({
                    "path": folder.and_then(|path| path.as_path().map(|value| value.to_string_lossy().into_owned()))
                }));
            }
        }
        "shell.saveDialog" => {
            if params.get("path").is_none() {
                let title = params
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Save Update Installer")
                    .to_string();
                let file_name = params
                    .get("defaultPath")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let mut builder = tauri_plugin_dialog::DialogExt::dialog(app)
                    .file()
                    .set_title(&title)
                    .set_can_create_directories(true);
                if !file_name.is_empty() {
                    builder = builder.set_file_name(&file_name);
                }
                let saved = builder.blocking_save_file();
                return Ok(json!({
                    "path": saved.and_then(|path| path.as_path().map(|value| value.to_string_lossy().into_owned()))
                }));
            }
        }
        "shell.revealItem" => {
            if let Some(path) = params.get("path").and_then(Value::as_str) {
                app.opener()
                    .reveal_item_in_dir(path)
                    .map_err(|error| error.to_string())?;
            }
        }
        "shell.openUpdate" => {
            if let Some(path) = params.get("path").and_then(Value::as_str) {
                open_update_installer(app, path)?;
            }
        }
        "shell.notify" | "shell.notifyAttention" => {
            let skipped = result.get("skipped").and_then(Value::as_bool) == Some(true);
            if !skipped {
                if let (Some(title), Some(body)) = (
                    params.get("title").and_then(Value::as_str),
                    params.get("body").and_then(Value::as_str),
                ) {
                    let _ = tauri_plugin_notification::NotificationExt::notification(app)
                        .builder()
                        .title(title)
                        .body(body)
                        .show();
                }
            }
            if method == "shell.notifyAttention" {
                let attention = result.get("attention").and_then(Value::as_u64).unwrap_or(0) as u32;
                if !skipped {
                    apply_attention_state(app, attention);
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
                    }
                }
            }
        }
        "shell.tray.upsert" | "shell.tray.remove" => {
            rebuild_tray_menu(app);
            rebuild_app_menu(app);
        }
        "shell.openTerminal" => {
            if let Some(command) = result.get("command").and_then(Value::as_array) {
                if let Some(program) = command.first().and_then(Value::as_str) {
                    let args = command
                        .iter()
                        .skip(1)
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect::<Vec<_>>();
                    spawn_terminal(app, program, args, &result);
                }
            }
        }
        "shell.prepareToQuit" => {
            state.quitting.store(true, Ordering::SeqCst);
        }
        "shell.restart" | "shell.restartRecovery" => {
            state.quitting.store(true, Ordering::SeqCst);
            if method == "shell.restartRecovery" {
                // The next launch must open the recovery assistant first.
                state.restart_recovery.store(true, Ordering::SeqCst);
            }
            app.restart();
        }
        "shell.setLocale" => {
            if let Some(locale) = result.get("locale").and_then(Value::as_str) {
                let resolved = tray_locale::locale_from_tag(locale);
                if let Ok(mut tray_locale) = state.tray_locale.lock() {
                    *tray_locale = resolved.to_string();
                }
            }
            rebuild_tray_menu(app);
            rebuild_app_menu(app);
        }
        "shell.setTheme" => {
            refresh_theme_material(app);
        }
        _ => {}
    }
    Ok(result)
}

/// Spawn the prepared terminal launcher; a failed spawn surfaces the upstream
/// error dialog instead of failing silently.
fn spawn_terminal(app: &AppHandle, program: &str, args: Vec<String>, result: &Value) {
    let cwd = result.get("cwd").and_then(Value::as_str);
    let environment = result.get("environment").and_then(Value::as_object);
    let mut command = std::process::Command::new(program);
    command.args(&args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    if let Some(environment) = environment {
        command.env_clear();
        for (key, value) in environment {
            if let Some(value) = value.as_str() {
                command.env(key, value);
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    if let Err(error) = command.spawn() {
        eprintln!("dsh-desktop: terminal launcher failed: {error}");
        let locale = current_tray_locale(app);
        let dialog = native_effects::terminal_launch_error_dialog(&locale, &error.to_string());
        let _ = open_dialog_window(app, dialog);
    }
}

fn open_update_installer(app: &AppHandle, path: &str) -> Result<(), String> {
    if cfg!(target_os = "macos") {
        app.opener()
            .open_path(path, None::<&str>)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let mut installer = std::process::Command::new(path);
        installer.args(["--updated", "--force-run"]).creation_flags(DETACHED_PROCESS);
        installer
            .spawn()
            .map_err(|error| error.to_string())?;
        if let Some(state) = app.try_state::<AppState>() {
            state.quitting.store(true, Ordering::SeqCst);
        }
        app.exit(0);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("update installers are unsupported on this platform".into())
    }
}

fn refresh_theme_material(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let material = app
            .try_state::<AppState>()
            .and_then(|state| {
                state
                    .session
                    .lock()
                    .ok()
                    .and_then(|session| session.last_plan.clone().map(|plan| plan.material))
            })
            .unwrap_or_else(|| "mica".to_string());
        // Windows can retain the preceding DWM palette until the backdrop is
        // recomposed; reapplying the active material invalidates it.
        if material == "mica" {
            let _ = window_vibrancy::apply_mica(&window, None);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id.as_ref();
    if let Some(tray_id) = id.strip_prefix("item:") {
        write_to_host(
            app,
            &protocol::RpcMessage::Event {
                v: protocol::PROTOCOL_VERSION,
                method: "event.trayInvoke".into(),
                params: Some(json!({ "id": tray_id })),
            },
        );
        return;
    }
    if let Some(submenu) = id.strip_prefix("submenu:") {
        let Some((tray_id, index)) = submenu.rsplit_once(':') else {
            return;
        };
        let Ok(index) = index.parse::<u32>() else {
            return;
        };
        write_to_host(
            app,
            &protocol::RpcMessage::Event {
                v: protocol::PROTOCOL_VERSION,
                method: "event.trayInvoke".into(),
                params: Some(json!({ "id": tray_id, "submenuIndex": index })),
            },
        );
        return;
    }
    match id {
        "show" => reveal_main_window(app),
        "quit" => {
            if let Some(state) = app.try_state::<AppState>() {
                state.quitting.store(true, Ordering::SeqCst);
            }
            app.exit(0);
        }
        _ => {}
    }
}

fn rebuild_tray_menu(app: &AppHandle) {
    let locale = current_tray_locale(app);
    let platform = current_platform();
    let product_name = current_product_name(app);
    let items = app
        .try_state::<AppState>()
        .and_then(|state| {
            state
                .session
                .lock()
                .ok()
                .map(|session| session.tray.clone())
        })
        .unwrap_or_default();
    let plan = tray_menu_plan(platform, &locale, &product_name, &items);
    let mut menu = MenuBuilder::new(app);
    let mut applied = 0usize;
    for entry in &plan {
        match entry {
            TrayPlanEntry::Open { label } => {
                let Ok(item) = MenuItemBuilder::with_id("show", label).build(app) else {
                    continue;
                };
                menu = menu.item(&item);
                applied += 1;
            }
            TrayPlanEntry::Quit { label } => {
                let Ok(item) = MenuItemBuilder::with_id("quit", label).build(app) else {
                    continue;
                };
                menu = menu.item(&item);
                applied += 1;
            }
            TrayPlanEntry::Separator => {
                let Ok(separator) = PredefinedMenuItem::separator(app) else {
                    continue;
                };
                menu = menu.item(&separator);
            }
            TrayPlanEntry::Item {
                id,
                label,
                enabled,
                submenu,
            } => {
                if submenu.is_empty() {
                    let Ok(item) = MenuItemBuilder::with_id(format!("item:{id}"), label)
                        .enabled(*enabled)
                        .build(app)
                    else {
                        continue;
                    };
                    menu = menu.item(&item);
                    applied += 1;
                } else {
                    let mut sub = SubmenuBuilder::new(app, label);
                    for (index, entry) in submenu.iter().enumerate() {
                        let sub_id = format!("submenu:{id}:{index}");
                        if entry.kind == "radio" || entry.kind == "checkbox" {
                            if let Ok(built) = CheckMenuItemBuilder::with_id(sub_id, &entry.label)
                                .checked(entry.checked)
                                .enabled(entry.enabled)
                                .build(app)
                            {
                                sub = sub.item(&built);
                            }
                        } else if let Ok(built) = MenuItemBuilder::with_id(sub_id, &entry.label)
                            .enabled(entry.enabled)
                            .build(app)
                        {
                            sub = sub.item(&built);
                        }
                    }
                    if let Ok(built) = sub.build() {
                        menu = menu.item(&built);
                        applied += 1;
                    }
                }
            }
        }
    }
    if applied == 0 {
        return;
    }
    if let Ok(menu) = menu.build() {
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_menu(Some(menu));
        }
    }
    apply_tray_icon(app);
}

/// darwin uses the template icon; win32/linux use the brand-blue icon.
fn apply_tray_icon(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let candidate = {
        let Ok(guard) = state.payload.lock() else {
            return;
        };
        let Some(payload) = guard.as_ref() else {
            return;
        };
        if cfg!(target_os = "macos") {
            payload.tray_icons.template_path.clone()
        } else {
            payload.tray_icons.blue_path.clone()
        }
    };
    if candidate.is_empty() {
        return;
    }
    match tauri::image::Image::from_path(&candidate) {
        Ok(image) => {
            if let Some(tray) = app.tray_by_id("main") {
                let _ = tray.set_icon(Some(image));
            }
        }
        Err(error) => eprintln!("dsh-desktop: failed to load tray icon {candidate}: {error}"),
    }
}

/// Install the localized macOS application menu (upstream: darwin only).
fn rebuild_app_menu(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let locale = app_menu::native_menu_locale(&[current_tray_locale(app).as_str()]);
    let product_name = current_product_name(app);
    let items = app
        .try_state::<AppState>()
        .and_then(|state| state.session.lock().ok().map(|session| session.tray.clone()))
        .unwrap_or_default();
    let additions: Vec<(String, String)> = items
        .iter()
        .filter(|item| item.group == "tools" || item.group == "profiles")
        .map(|item| (item.id.clone(), item.label.clone()))
        .collect();
    let addition_refs: Vec<(&str, &str)> = additions
        .iter()
        .map(|(id, label)| (id.as_str(), label.as_str()))
        .collect();
    let plan = app_menu::app_menu_plan(current_platform(), locale, &product_name, &addition_refs);
    if plan.sections.is_empty() {
        return;
    }
    let mut top = MenuBuilder::new(app);
    for section in &plan.sections {
        let mut submenu = SubmenuBuilder::new(app, &section.title);
        for entry in &section.entries {
            match entry {
                app_menu::MenuEntry::Role { role, label } => {
                    if let Some(item) = predefined_role_item(app, role, label) {
                        submenu = submenu.item(&item);
                    }
                }
                app_menu::MenuEntry::Item { id, label } => {
                    if let Ok(item) = MenuItemBuilder::with_id(format!("item:{id}"), label).build(app) {
                        submenu = submenu.item(&item);
                    }
                }
                app_menu::MenuEntry::Separator => {
                    if let Ok(separator) = PredefinedMenuItem::separator(app) {
                        submenu = submenu.item(&separator);
                    }
                }
            }
        }
        if let Ok(built) = submenu.build() {
            top = top.item(&built);
        }
    }
    if let Ok(menu) = top.build() {
        if let Some(state) = app.try_state::<AppState>() {
            let _ = state.app_menu_revision.fetch_add(1, Ordering::SeqCst);
        }
        let _ = menu.set_as_app_menu();
    }
}

fn predefined_role_item(
    app: &AppHandle,
    role: &str,
    label: &str,
) -> Option<tauri::menu::PredefinedMenuItem<tauri::Wry>> {
    match role {
        "about" => PredefinedMenuItem::about(app, Some(label), None),
        "services" => PredefinedMenuItem::services(app, Some(label)),
        "hide" => PredefinedMenuItem::hide(app, Some(label)),
        "hideOthers" => PredefinedMenuItem::hide_others(app, Some(label)),
        "unhide" => PredefinedMenuItem::show_all(app, Some(label)),
        "quit" => PredefinedMenuItem::quit(app, Some(label)),
        "close" => PredefinedMenuItem::close_window(app, Some(label)),
        "undo" => PredefinedMenuItem::undo(app, Some(label)),
        "redo" => PredefinedMenuItem::redo(app, Some(label)),
        "cut" => PredefinedMenuItem::cut(app, Some(label)),
        "copy" => PredefinedMenuItem::copy(app, Some(label)),
        "paste" => PredefinedMenuItem::paste(app, Some(label)),
        "selectAll" => PredefinedMenuItem::select_all(app, Some(label)),
        "minimize" => PredefinedMenuItem::minimize(app, Some(label)),
        "zoom" => PredefinedMenuItem::maximize(app, Some(label)),
        "togglefullscreen" => PredefinedMenuItem::fullscreen(app, Some(label)),
        _ => return None,
    }
    .ok()
}

fn mount_main_window(app: &AppHandle, payload: &ShellPayload) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main window missing".into());
    };
    let plan = {
        let state = app.state::<AppState>();
        let session = state.session.lock().expect("session");
        session.last_plan.clone()
    };
    let material = plan
        .as_ref()
        .map(|plan| plan.material.as_str())
        .unwrap_or(payload.material.as_str());
    apply_material(&window, material);
    let chrome = plan
        .as_ref()
        .map(|plan| plan.chrome.clone())
        .unwrap_or_else(|| chrome_for_mode(payload.mode.as_str()));
    apply_traffic_light_chrome(&window, chrome.titlebar_height);
    #[cfg(target_os = "macos")]
    {
        let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
    }
    if let Some(plan) = plan.as_ref() {
        let zoom = 1.0 + f64::from(plan.zoom_level) * 0.1;
        let _ = window.eval(&format!("document.documentElement.style.zoom = '{zoom}'"));
        if let Some(bounds) = &plan.bounds {
            let fitted = fit_restored_bounds(app, bounds.clone(), payload);
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                x: fitted.x,
                y: fitted.y,
            }));
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize {
                width: fitted.width,
                height: fitted.height,
            }));
        }
    }
    let parsed = url::Url::parse(&payload.url).map_err(|error: url::ParseError| error.to_string())?;
    #[cfg(dsh_devtools)]
    eprintln!("dsh-desktop: mounting renderer url {}", payload.url);
    // JS-initiated navigation: loadRequest (wry navigate) left the committed
    // page's subresource loads unscheduled on macOS; location.href goes through
    // the ordinary WebKit navigation path.
    let _ = parsed;
    window
        .eval(&format!("location.href = {}", serde_json::to_string(&payload.url).unwrap()))
        .map_err(|error| error.to_string())?;
    let _ = window.set_title(&payload.window_title);
    let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize {
        width: payload.min_width as f64,
        height: payload.min_height as f64,
    })));
    // NOTE: the historical second navigation via location.replace raced the
    // navigate() load and cancelled its in-flight subresources; navigate alone
    // is the correct single load.
    let _ = serde_json::to_string(&payload.url);
    let _ = window.show();
    Ok(())
}

/// Clamp restored geometry into the current monitor's work area on mount.
fn fit_restored_bounds(app: &AppHandle, bounds: WindowBounds, payload: &ShellPayload) -> WindowBounds {
    let Some(window) = app.get_webview_window("main") else {
        return bounds;
    };
    let Ok(Some(monitor)) = window.current_monitor() else {
        return bounds;
    };
    let size = monitor.size();
    let position = monitor.position();
    let work_area = WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    fit_main_window_bounds(bounds, work_area, (payload.min_width, payload.min_height))
}

fn apply_material(window: &tauri::WebviewWindow, material: &str) {
    #[cfg(target_os = "macos")]
    if material == "transparent" {
        let _ = window_vibrancy::apply_vibrancy(
            window,
            window_vibrancy::NSVisualEffectMaterial::Sidebar,
            None,
            None,
        );
    }
    #[cfg(target_os = "windows")]
    {
        if material == "mica" {
            let _ = window_vibrancy::apply_mica(window, None);
        }
    }
}

fn open_devtools_window(app: &AppHandle, href: &str) -> Result<(), String> {
    #[cfg(not(dsh_devtools))]
    {
        let _ = (app, href);
        return Ok(());
    }
    #[cfg(dsh_devtools)]
    {
        let parsed = url::Url::parse(href).map_err(|error: url::ParseError| error.to_string())?;
        if let Some(existing) = app.get_webview_window("devtools") {
            existing.navigate(parsed).map_err(|error| error.to_string())?;
            let _ = existing.show();
            let _ = existing.set_focus();
            return Ok(());
        }
        WebviewWindowBuilder::new(app, "devtools", WebviewUrl::External(parsed))
            .title("DSH Desktop · Developer")
            .inner_size(920.0, 640.0)
            .build()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn open_recovery_window(app: &AppHandle, state: Value) -> Result<(), String> {
    let encoded = data_encoding_base64url(&state);
    let url = format!("recovery.html?state={encoded}");
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = open_auxiliary(&handle, "recovery", &url, AuxiliaryKind::Recovery);
    })
    .map_err(|error| error.to_string())
}

/// Upstream dialog geometry: normal and diagnostic presentations.
fn dialog_geometry(presentation: &str) -> (f64, f64, f64, f64) {
    if presentation == "diagnostic" {
        // width, initial height, min width, max width
        (680.0, 460.0, 560.0, 860.0)
    } else {
        (480.0, 300.0, 420.0, 620.0)
    }
}

fn open_dialog_window(app: &AppHandle, params: Value) -> Result<Value, String> {
    let buttons = params
        .get("buttons")
        .and_then(Value::as_array)
        .map(|items| items.len())
        .unwrap_or(1);
    let cancel = params
        .get("cancelId")
        .and_then(Value::as_u64)
        .unwrap_or(buttons.saturating_sub(1) as u64) as u32;
    let presentation = params
        .get("presentation")
        .and_then(Value::as_str)
        .unwrap_or("default")
        .to_string();
    let mut state = serde_json::Map::new();
    state.insert("type".into(), params.get("type").cloned().unwrap_or(Value::String("none".into())));
    state.insert("title".into(), params.get("title").cloned().unwrap_or(Value::String("DSH Desktop".into())));
    state.insert("message".into(), params.get("message").cloned().unwrap_or(Value::String(String::new())));
    if let Some(detail) = params.get("detail") {
        state.insert("detail".into(), detail.clone());
    }
    state.insert("buttons".into(), params.get("buttons").cloned().unwrap_or(json!(["OK"])));
    state.insert("defaultId".into(), params.get("defaultId").cloned().unwrap_or(json!(0)));
    state.insert("cancelId".into(), params.get("cancelId").cloned().unwrap_or(json!(buttons.saturating_sub(1))));
    state.insert("presentation".into(), Value::String(presentation.clone()));
    let encoded = data_encoding_base64url(&Value::Object(state));
    let (width, height, min_width, max_width) = dialog_geometry(&presentation);
    if let Some(existing) = app.get_webview_window("dialog") {
        let _ = existing.close();
    }
    let (tx, rx) = mpsc::channel::<u32>();
    let nav_handle = app.app_handle().clone();
    let mut builder = WebviewWindowBuilder::new(
        app,
        "dialog",
        WebviewUrl::App(
            format!(
                "desktop-dialog.html?state={encoded}&platform={}&frame=true",
                current_platform()
            )
            .into(),
        ),
    )
    .title("DSH Desktop")
    .inner_size(width, height)
    .min_inner_size(min_width, dialog::DIALOG_MIN_CONTENT_HEIGHT as f64)
    .max_inner_size(max_width, 4096.0)
    // Upstream dialog windows are frameless modal children of the main window.
    .decorations(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .resizable(false);
    if let Some(main) = app.get_webview_window("main") {
        #[cfg(target_os = "macos")]
        {
            if let Ok(ns_window) = main.ns_window() {
                builder = builder.parent_raw(ns_window);
            }
        }
        #[cfg(target_os = "windows")]
        {
            if let Ok(hwnd) = main.hwnd() {
                builder = builder.parent_raw(hwnd);
            }
        }
    }
    let dialog = builder
        .on_navigation(move |url| {
            let href = url.as_str();
            if let Some(response) = dialog::parse_dialog_response(href, buttons) {
                let _ = tx.send(response);
                return false;
            }
            if let Some(reported) = dialog::parse_dialog_layout(href) {
                // Resize to the rendered content height the local UI measured.
                if let Some(window) = nav_handle.get_webview_window("dialog") {
                    let clamped = reported.max(dialog::DIALOG_MIN_CONTENT_HEIGHT);
                    let size = tauri::LogicalSize::new(width, clamped as f64);
                    let _ = window.set_size(tauri::Size::Logical(size));
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|error| error.to_string())?;
    let _ = dialog.show();
    let _ = dialog.set_focus();
    let response = rx.recv_timeout(Duration::from_secs(300)).unwrap_or(cancel);
    if let Some(window) = app.get_webview_window("dialog") {
        let _ = window.close();
    }
    Ok(json!({ "response": response }))
}

enum AuxiliaryKind {
    ProfileCreate,
    Recovery,
}

fn open_auxiliary(
    app: &AppHandle,
    label: &str,
    url: &str,
    kind: AuxiliaryKind,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(label) {
        #[cfg(target_os = "macos")]
        {
            // macOS unhides the app before revealing auxiliary windows.
            let _ = app.show();
        }
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let app_handle = app.clone();
    let zh = current_tray_locale(app) == "zh";
    let (width, height, min_width, min_height, resizable, title) = match &kind {
        AuxiliaryKind::ProfileCreate => (
            480.0,
            360.0,
            420.0,
            330.0,
            false,
            if zh { "新建 Profile" } else { "New Profile" }.to_string(),
        ),
        AuxiliaryKind::Recovery => (
            800.0,
            760.0,
            680.0,
            560.0,
            true,
            if zh { "DSH Desktop 恢复助手" } else { "DSH Desktop Recovery Assistant" }.to_string(),
        ),
    };
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .resizable(resizable)
        .on_navigation(move |href| !handle_auxiliary_navigation(&app_handle, href.as_str()));
    if matches!(kind, AuxiliaryKind::Recovery) {
        if let Some(main) = app.get_webview_window("main") {
            if let (Ok(size), Ok(position)) = (main.inner_size(), main.outer_position()) {
                let max_width = (size.width as f64 - 48.0).max(680.0);
                let max_height = (size.height as f64 - 48.0).max(560.0);
                builder = builder
                    .max_inner_size(max_width, max_height)
                    .position(position.x as f64 + 24.0, position.y as f64 + 24.0);
            }
        }
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

/// Resolve `dsh-profile-create://` and `dsh-recovery://` action hrefs from the
/// auxiliary windows into Host dispatches. Returns whether the href was an
/// action (and therefore must not navigate).
fn handle_auxiliary_navigation(app: &AppHandle, href: &str) -> bool {
    if let Some(action) = profile_create::parse_profile_create_href(href) {
        match action {
            profile_create::ProfileCreateAction::Submit { name } => {
                let outcome = app
                    .try_state::<AppState>()
                    .and_then(|state| {
                        state
                            .session
                            .lock()
                            .ok()
                            .and_then(|mut session| session.dispatch("shell.openProfileCreate", json!({ "name": name })).ok())
                    });
                match outcome {
                    Some(_) => {
                        if let Some(window) = app.get_webview_window("profile-create") {
                            let _ = window.close();
                        }
                    }
                    None => {
                        if let Some(window) = app.get_webview_window("profile-create") {
                            let message = if current_tray_locale(app) == "zh" {
                                "无法创建 Profile，请检查名称后重试。"
                            } else {
                                "The Profile could not be created. Check the name and try again."
                            };
                            let _ = window.eval(&format!(
                                "window.dispatchEvent(new CustomEvent('dsh-profile-create-error', {{ detail: {{ message: {} }} }}));",
                                serde_json::to_string(message).unwrap_or_default()
                            ));
                        }
                    }
                }
            }
            profile_create::ProfileCreateAction::Cancel => {
                if let Some(window) = app.get_webview_window("profile-create") {
                    let _ = window.close();
                }
            }
        }
        return true;
    }
    if let Some(_action) = recovery::parse_recovery_href(href) {
        if let Some(state) = app.try_state::<AppState>() {
            if let Ok(mut session) = state.session.lock() {
                let _ = session.dispatch("shell.openRecovery", json!({ "href": href }));
                let lifecycle = session.pending_lifecycle.clone();
                drop(session);
                if lifecycle.as_deref() == Some("quit") {
                    app.exit(0);
                }
                if lifecycle.as_deref() == Some("restart") {
                    // Relaunching from the recovery assistant re-enters recovery.
                    state.quitting.store(true, Ordering::SeqCst);
                    state.restart_recovery.store(true, Ordering::SeqCst);
                    app.restart();
                }
            }
        }
        return true;
    }
    false
}

fn open_profile_create_window(app: &AppHandle, _locale: &str) -> Result<(), String> {
    open_auxiliary(app, "profile-create", "profile-create.html", AuxiliaryKind::ProfileCreate)
}

fn data_encoding_base64url(value: &Value) -> String {
    let json = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    URL_SAFE_NO_PAD.encode(json)
}

#[allow(dead_code)]
const _PROTOCOL: u8 = PROTOCOL_VERSION;
