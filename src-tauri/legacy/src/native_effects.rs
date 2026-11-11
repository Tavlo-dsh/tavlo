use crate::bootstrap::{self, NativeBootstrap};
use crate::dialog::parse_dialog_response;
use crate::profile::{self, write_profile_state};
use crate::recovery::{parse_recovery_href, RecoveryAction};
#[cfg(target_os = "windows")]
use crate::volume_admission::{volume_admission, VolumeDecision};
use crate::window_ops::{
    folder_drop_script, load_window_bounds, persist_window_bounds, plan_generation, should_open_externally,
    WindowApplyPlan, WindowBounds,
};
use crate::window_spec::ShellPayload;
use crate::zip_store::build_zip_store;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraySubmenu {
    pub label: String,
    pub kind: String,
    pub enabled: bool,
    pub checked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayItem {
    pub id: String,
    pub group: String,
    pub order: i64,
    pub label: String,
    pub enabled: bool,
    pub submenu: Vec<TraySubmenu>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopNotification {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalLaunch {
    pub profile_name: String,
    pub command: Vec<String>,
    pub record_path: PathBuf,
    pub script_path: PathBuf,
    pub cwd: Option<String>,
    pub environment: Option<serde_json::Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateOutcome {
    pub status: String,
    pub current_version: String,
    pub latest_version: String,
}

pub struct NativeSession {
    pub user_data: PathBuf,
    pub platform: String,
    pub tray: Vec<TrayItem>,
    pub notifications: Vec<DesktopNotification>,
    pub attention: u32,
    pub focused: bool,
    pub terminal_launches: Vec<TerminalLaunch>,
    pub zoom_level: i32,
    pub bounds: Option<WindowBounds>,
    /// Last rectangle actually written to disk (live moves must not skip writes).
    pub persisted_bounds: Option<WindowBounds>,
    pub last_drop_script: Option<String>,
    pub pending_lifecycle: Option<String>,
    pub last_update: Option<UpdateOutcome>,
    pub last_download: Option<PathBuf>,
    pub last_diagnostics: Option<PathBuf>,
    /// Path requested for reveal (Finder); the actual opener call is a Tauri side effect.
    pub last_revealed: Option<PathBuf>,
    pub last_plan: Option<WindowApplyPlan>,
    pub theme: Option<String>,
    pub locale: Option<String>,
    pub payload: Option<ShellPayload>,
    generation: u64,
    current_generation: Option<String>,
}

impl NativeSession {
    pub fn new(user_data: PathBuf, platform: impl Into<String>) -> Self {
        let bounds = match load_window_bounds(&user_data) {
            Ok(bounds) => bounds,
            Err(error) => {
                eprintln!("dsh-desktop: ignoring main-window state: {error}");
                None
            }
        };
        let persisted_bounds = bounds.clone();
        Self {
            user_data,
            platform: platform.into(),
            tray: Vec::new(),
            notifications: Vec::new(),
            attention: 0,
            focused: false,
            terminal_launches: Vec::new(),
            zoom_level: 0,
            bounds,
            persisted_bounds,
            last_drop_script: None,
            pending_lifecycle: None,
            last_update: None,
            last_download: None,
            last_diagnostics: None,
            last_revealed: None,
            last_plan: None,
            theme: None,
            locale: None,
            payload: None,
            generation: 0,
            current_generation: None,
        }
    }

    /// Clear the accumulated attention counter (badge / flash frame).
    pub fn clear_attention(&mut self) -> bool {
        if self.attention == 0 {
            return false;
        }
        self.attention = 0;
        true
    }

    pub fn listed_tray_ids(&self) -> Vec<String> {
        self.tray.iter().map(|item| item.id.clone()).collect()
    }

    pub fn dispatch(&mut self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "shell.schedule" => {
                let payload: ShellPayload =
                    serde_json::from_value(params).map_err(|error| error.to_string())?;
                self.payload = Some(payload);
                self.generation += 1;
                let id = format!("g{}", self.generation);
                self.current_generation = Some(id.clone());
                Ok(json!({ "generationId": id }))
            }
            "shell.mount" => {
                let payload = self
                    .payload
                    .clone()
                    .ok_or_else(|| "no scheduled generation".to_string())?;
                let plan = plan_generation(
                    &self.platform,
                    &payload.mode,
                    if payload.material == "transparent" || payload.material == "off" {
                        payload.material.as_str()
                    } else {
                        "transparent"
                    },
                    if payload.material == "mica" {
                        "mica"
                    } else {
                        "off"
                    },
                    None,
                    self.zoom_level,
                    self.bounds.clone(),
                );
                self.last_plan = Some(plan);
                Ok(json!({ "ok": true, "mode": self.last_plan.as_ref().map(|plan| plan.mode.clone()) }))
            }
            "shell.release" => {
                self.current_generation = None;
                self.payload = None;
                self.tray.clear();
                Ok(json!({ "ok": true }))
            }
            "shell.show" => Ok(json!({ "ok": true })),
            "shell.tray.upsert" => {
                let item = parse_tray_item(&params)?;
                if let Some(existing) = self.tray.iter_mut().find(|candidate| candidate.id == item.id) {
                    *existing = item;
                } else {
                    self.tray.push(item);
                }
                self.tray.sort_by(|left, right| left.order.cmp(&right.order).then(left.id.cmp(&right.id)));
                Ok(json!({
                    "ok": true,
                    "ids": self.listed_tray_ids(),
                }))
            }
            "shell.tray.remove" => {
                let id = params
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "tray id required".to_string())?;
                self.tray.retain(|item| item.id != id);
                Ok(json!({ "ok": true, "ids": self.listed_tray_ids() }))
            }
            "shell.notify" => {
                let notification = DesktopNotification {
                    title: text_field(&params, "title")?,
                    body: text_field(&params, "body")?,
                };
                self.notifications.push(notification.clone());
                Ok(json!({ "ok": true, "queued": self.notifications.len() }))
            }
            "shell.notifyAttention" => {
                // The upstream product skips the whole notification (and badge)
                // when the main window already has focus.
                if self.focused {
                    return Ok(json!({ "ok": true, "skipped": true, "attention": self.attention }));
                }
                self.attention = self.attention.saturating_add(1);
                if params.get("title").and_then(Value::as_str).is_some() {
                    self.notifications.push(DesktopNotification {
                        title: text_field(&params, "title").unwrap_or_else(|_| "DSH Desktop".into()),
                        body: params
                            .get("body")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                    });
                }
                Ok(json!({ "ok": true, "attention": self.attention }))
            }
            "shell.openTerminal" => {
                let launch = record_terminal_launch(&self.user_data, &self.platform, &params)?;
                self.terminal_launches.push(launch.clone());
                Ok(json!({
                    "ok": true,
                    "command": launch.command,
                    "recordPath": launch.record_path,
                    "scriptPath": launch.script_path,
                    "cwd": launch.cwd,
                    "environment": launch.environment,
                }))
            }
            "shell.exportDiagnostics" => {
                let node_version = params
                    .get("nodeVersion")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let path = export_diagnostics_archive(
                    &self.user_data,
                    "0.1.0",
                    node_version.as_deref(),
                )?;
                self.last_diagnostics = Some(path.clone());
                Ok(json!({ "ok": true, "path": path }))
            }
            "shell.confirmUpdate" | "shell.showUpdateResult" => {
                let outcome = parse_update_outcome(&params)?;
                self.last_update = Some(outcome.clone());
                Ok(json!({
                    "ok": true,
                    "status": outcome.status,
                    "currentVersion": outcome.current_version,
                    "latestVersion": outcome.latest_version,
                }))
            }
            "shell.downloadUpdate" => {
                let path = save_update_payload(&self.user_data, &params)?;
                self.last_download = Some(path.clone());
                Ok(json!({ "ok": true, "path": path }))
            }
            "shell.setTheme" => {
                self.theme = params.get("source").and_then(Value::as_str).map(str::to_string);
                Ok(json!({ "ok": true, "source": self.theme }))
            }
            "shell.setLocale" => {
                self.locale = params.get("locale").and_then(Value::as_str).map(str::to_string);
                Ok(json!({ "ok": true, "locale": self.locale }))
            }
            "shell.reportRendererBoot" => Ok(json!({ "ok": true, "status": params.get("status") })),
            "shell.prepareToQuit" => {
                self.pending_lifecycle = Some("quit".into());
                Ok(json!({ "ok": true }))
            }
            "shell.restart" => {
                self.pending_lifecycle = Some("restart".into());
                Ok(json!({ "ok": true, "lifecycle": "restart" }))
            }
            "shell.restartRecovery" => {
                self.pending_lifecycle = Some("recovery".into());
                Ok(json!({ "ok": true, "lifecycle": "recovery" }))
            }
            "shell.writeBootstrap" => {
                let profile = params
                    .get("profileName")
                    .and_then(Value::as_str)
                    .unwrap_or("desktop");
                let mode = params
                    .get("mode")
                    .and_then(Value::as_str)
                    .unwrap_or("compatibility");
                profile::assert_profile_name(profile)?;
                bootstrap::write_native_bootstrap(&self.user_data, profile, mode)
                    .map_err(|error| error.to_string())?;
                Ok(json!({ "ok": true }))
            }
            "shell.openRecovery" => {
                if let Some(action) = params.get("href").and_then(Value::as_str).and_then(parse_recovery_href)
                {
                    return self.apply_recovery(action);
                }
                Ok(json!({ "ok": true, "opened": true }))
            }
            "shell.openProfileCreate" => {
                if let Some(name) = params.get("name").and_then(Value::as_str) {
                    return persist_profile_selection(&self.user_data, name);
                }
                Ok(json!({ "ok": true, "opened": true }))
            }
            "shell.openDialog" => {
                if let Some(href) = params.get("href").and_then(Value::as_str) {
                    let count = params
                        .get("buttons")
                        .and_then(Value::as_array)
                        .map(Vec::len)
                        .unwrap_or(2);
                    let response = parse_dialog_response(href, count)
                        .ok_or_else(|| "invalid dialog href".to_string())?;
                    return Ok(json!({ "response": response }));
                }
                Ok(json!({ "response": params.get("cancelId").and_then(Value::as_u64).unwrap_or(0) }))
            }
            "shell.revealItem" => {
                if let Some(path) = params.get("path").and_then(Value::as_str) {
                    self.last_revealed = Some(PathBuf::from(path));
                }
                Ok(json!({ "ok": true }))
            }
            "shell.pickDirectory" => Ok(json!({ "path": params.get("path") })),
            "shell.validateDirectory" => {
                let path = params.get("path").and_then(Value::as_str).unwrap_or("");
                if self.platform != "win32" {
                    return Ok(json!({ "ok": true, "decision": "allow" }));
                }
                #[cfg(target_os = "windows")]
                {
                    let queried = crate::volume_admission::query_volume(path);
                    let decision = match &queried {
                        Some((file_system, drive_type)) => volume_admission(Some(file_system), Some(*drive_type)),
                        None => VolumeDecision::Block,
                    };
                    let file_system = queried
                        .map(|(file_system, _)| file_system)
                        .unwrap_or_default();
                    return match decision {
                        VolumeDecision::Allow => Ok(json!({ "ok": true, "decision": "allow" })),
                        VolumeDecision::Confirm => Ok(json!({ "ok": false, "decision": "confirm", "fileSystem": file_system })),
                        VolumeDecision::Block => Ok(json!({ "ok": false, "decision": "block", "fileSystem": file_system })),
                    };
                }
                #[cfg(not(target_os = "windows"))]
                {
                    // The Windows volume query is unavailable off-target; the
                    // decision function itself is covered by unit tests.
                    let _ = path;
                    Ok(json!({ "ok": true, "decision": "allow" }))
                }
            }
            "shell.reloadRenderer" | "shell.toggleDeveloperTools" => Ok(json!({ "ok": true })),
            "shell.openDevtools" => {
                let origin = params
                    .get("origin")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "origin required".to_string())?
                    .trim_end_matches('/');
                let tab = params.get("tab").and_then(Value::as_str).unwrap_or("logs");
                if tab != "logs" && tab != "network" {
                    return Err("tab must be logs or network".into());
                }
                Ok(json!({
                    "ok": true,
                    "url": format!("{origin}/_dsh/dev/ui?tab={tab}"),
                }))
            }
            "shell.persistBounds" => {
                let bounds = WindowBounds {
                    x: params.get("x").and_then(Value::as_i64).unwrap_or(0) as i32,
                    y: params.get("y").and_then(Value::as_i64).unwrap_or(0) as i32,
                    width: params.get("width").and_then(Value::as_u64).unwrap_or(0) as u32,
                    height: params.get("height").and_then(Value::as_u64).unwrap_or(0) as u32,
                };
                persist_window_bounds(&self.user_data, &bounds)?;
                self.bounds = Some(bounds);
                Ok(json!({ "ok": true }))
            }
            "shell.dropPaths" => {
                let paths = params
                    .get("paths")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let x = params.get("x").and_then(Value::as_f64).unwrap_or(0.0);
                let y = params.get("y").and_then(Value::as_f64).unwrap_or(0.0);
                let script = folder_drop_script(&paths, x, y);
                self.last_drop_script = Some(script.clone());
                Ok(json!({ "ok": true, "script": script }))
            }
            "shell.openExternal" => {
                let page = params
                    .get("origin")
                    .and_then(Value::as_str)
                    .unwrap_or("http://127.0.0.1/");
                let href = params.get("href").and_then(Value::as_str).unwrap_or("");
                Ok(json!({ "external": should_open_externally(page, href) }))
            }
            other => Err(format!("unknown native method {other}")),
        }
    }

    fn apply_recovery(&mut self, action: RecoveryAction) -> Result<Value, String> {
        match apply_recovery_action(&self.user_data, &action)? {
            RecoveryEffect::Restart => {
                self.pending_lifecycle = Some("restart".into());
                Ok(json!({ "ok": true, "lifecycle": "restart" }))
            }
            RecoveryEffect::Quit => {
                self.pending_lifecycle = Some("quit".into());
                Ok(json!({ "ok": true, "lifecycle": "quit" }))
            }
            RecoveryEffect::Diagnostics(path) => {
                self.last_diagnostics = Some(path.clone());
                Ok(json!({ "ok": true, "path": path }))
            }
            RecoveryEffect::Profile(name) => persist_profile_selection(&self.user_data, &name),
            RecoveryEffect::Ignored => Ok(json!({ "ok": true, "ignored": true })),
        }
    }
}

fn parse_tray_item(params: &Value) -> Result<TrayItem, String> {
    let submenu = params
        .get("submenu")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    let kind = item.get("type").and_then(Value::as_str).unwrap_or("normal");
                    if !matches!(kind, "normal" | "checkbox" | "radio") {
                        return Err("tray submenu type must be normal, checkbox, or radio".to_string());
                    }
                    Ok(TraySubmenu {
                        label: item
                            .get("label")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string(),
                        kind: kind.to_string(),
                        enabled: item.get("enabled").and_then(Value::as_bool).unwrap_or(true),
                        checked: item.get("checked").and_then(Value::as_bool).unwrap_or(false),
                    })
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .unwrap_or_default();
    Ok(TrayItem {
        id: text_field(params, "id")?,
        group: params
            .get("group")
            .and_then(Value::as_str)
            .unwrap_or("tools")
            .to_string(),
        order: params.get("order").and_then(Value::as_i64).unwrap_or(0),
        label: text_field(params, "label")?,
        enabled: params.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        submenu,
    })
}

fn text_field(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("{key} required"))
}

pub fn terminal_command(platform: &str, script_path: &Path) -> Vec<String> {
    match platform {
        "darwin" => vec![
            "open".into(),
            "-a".into(),
            "Terminal".into(),
            script_path.display().to_string(),
        ],
        "win32" => vec![
            "cmd".into(),
            "/c".into(),
            "start".into(),
            "".into(),
            script_path.display().to_string(),
        ],
        // The upstream product fails loudly on Linux instead of opening an
        // unconfigured terminal; the Host adapter surfaces the error dialog.
        _ => vec!["x-terminal-emulator".into(), "-e".into(), script_path.display().to_string()],
    }
}

pub fn record_terminal_launch(
    user_data: &Path,
    platform: &str,
    params: &Value,
) -> Result<TerminalLaunch, String> {
    let profile_name = text_field(params, "profileName")?;
    if platform == "linux" {
        return Err("terminal is unsupported on linux".into());
    }
    let profile_dir = params
        .get("profileDir")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let home_dir = params
        .get("homeDir")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let dir = user_data.join("terminal-launches");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let provided_script = params
        .get("scriptPath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let script_path = if let Some(path) = provided_script {
        path
    } else {
        let path = dir.join(if platform == "win32" {
            format!("{stamp}.cmd")
        } else if platform == "darwin" {
            format!("{stamp}.command")
        } else {
            format!("{stamp}.sh")
        });
        let script = if platform == "win32" {
            format!("@echo off\r\ncd /d {profile_dir}\r\nset DSH_HOME={home_dir}\r\n")
        } else {
            format!(
                "#!/bin/sh\nexport DSH_HOME={home_dir:?}\ncd {profile_dir:?}\nprintf '%s\\n' 'DSH Desktop terminal'\nprintf '%s\\n' 'Profile: {profile_name}'\nexec \"$SHELL\" -i\n"
            )
        };
        fs::write(&path, script).map_err(|error| error.to_string())?;
        path
    };
    if platform != "win32" {
        set_unix_executable(&script_path)?;
    }
    let command = params
        .get("command")
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty())
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| terminal_command(platform, &script_path));
    let record_path = dir.join(format!("{stamp}.json"));
    let cwd = params
        .get("cwd")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let environment = params
        .get("environment")
        .and_then(Value::as_object)
        .cloned();
    let record = json!({
        "profileName": profile_name,
        "profileDir": profile_dir,
        "homeDir": home_dir,
        "command": command,
        "scriptPath": script_path,
    });
    fs::write(
        &record_path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&record).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| error.to_string())?;
    Ok(TerminalLaunch {
        profile_name,
        command,
        record_path,
        script_path,
        cwd,
        environment,
    })
}

pub const UNIX_EXECUTABLE_MODE: u32 = 0o700;

/// Upstream terminal launch failure dialog copy (`reportTerminalLaunchError`).
pub fn terminal_launch_error_dialog(locale: &str, detail: &str) -> Value {
    let zh = locale == "zh";
    json!({
        "type": "error",
        "title": if zh { "无法打开 DSH 终端" } else { "Unable to Open DSH Terminal" },
        "message": if zh { "DSH Desktop 无法打开终端。" } else { "DSH Desktop could not open a terminal." },
        "detail": detail,
        "buttons": [if zh { "确定" } else { "OK" }],
        "defaultId": 0,
        "cancelId": 0,
    })
}

pub fn set_unix_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(UNIX_EXECUTABLE_MODE);
        fs::set_permissions(path, permissions).map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = path;
    }
    Ok(())
}

/// Upstream log archive naming: `dsh-YYYY-MM-DD(.error)?(.n)?.log`.
pub fn is_dsh_log_file_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("dsh-") else {
        return false;
    };
    let Some(stem) = rest.strip_suffix(".log") else {
        return false;
    };
    let mut parts = stem.split('.');
    let date = parts.next().unwrap_or("");
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let digits = |slice: &str| !slice.is_empty() && slice.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(&date[0..4]) || !digits(&date[5..7]) || !digits(&date[8..10]) {
        return false;
    }
    match (parts.next(), parts.next(), parts.next()) {
        (None, None, None) => true,
        (Some("error"), None, None) => true,
        (Some(number), None, None) => digits(number),
        (Some("error"), Some(number), None) => digits(number),
        _ => false,
    }
}

const MAX_DIAGNOSTIC_EVIDENCE_BYTES: usize = 50 * 1024 * 1024;
const DIAGNOSTIC_ARCHIVE_KEEP: usize = 3;

pub fn export_diagnostics_archive(
    user_data: &Path,
    app_version: &str,
    node_version: Option<&str>,
) -> Result<PathBuf, String> {
    let exported = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let mut system_info = format!(
        "app: dsh-plugin-desktop\ndesktop-version: {app_version}\nplatform: {}\narch: {}\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    match node_version {
        Some(version) if !version.is_empty() => system_info.push_str(&format!("node: {version}\n")),
        _ => system_info.push_str("node: unknown\n"),
    }
    system_info.push_str(&format!("exported: {exported}\n"));
    let mut files: Vec<(String, Vec<u8>)> = vec![("system-info.txt".to_string(), system_info.into_bytes())];
    let mut evidence_bytes = 0usize;
    let mut push_evidence = |files: &mut Vec<(String, Vec<u8>)>, name: String, bytes: Vec<u8>| -> bool {
        if evidence_bytes + bytes.len() > MAX_DIAGNOSTIC_EVIDENCE_BYTES {
            return false;
        }
        evidence_bytes += bytes.len();
        files.push((name, bytes));
        true
    };
    let logs = user_data.join("logs");
    if let Ok(entries) = fs::read_dir(&logs) {
        let mut names: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .map(|name| is_dsh_log_file_name(&name.to_string_lossy()))
                    .unwrap_or(false)
            })
            .collect();
        names.sort();
        for path in names {
            if let Ok(bytes) = fs::read(&path) {
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                if !push_evidence(&mut files, format!("logs/{name}"), bytes) {
                    break;
                }
            }
        }
    }
    for (directory, prefix) in [
        (user_data.join("crash-dumps"), "crash-dumps"),
        (user_data.join("lifecycle-events"), "lifecycle-events"),
    ] {
        if let Ok(entries) = fs::read_dir(&directory) {
            let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
            paths.sort();
            for path in paths {
                if let Ok(bytes) = fs::read(&path) {
                    let name = path.file_name().unwrap().to_string_lossy().into_owned();
                    if !push_evidence(&mut files, format!("{prefix}/{name}"), bytes) {
                        break;
                    }
                }
            }
        }
    }
    let marker = user_data.join("crash-evidence").join("active-run.json");
    if let Ok(bytes) = fs::read(&marker) {
        let _ = push_evidence(&mut files, "crash-evidence/active-run.json".into(), bytes);
    }
    let zip = build_zip_store(&files);
    let dir = user_data.join("diagnostics");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("dsh-diagnostics-{exported}.zip"));
    let temporary = dir.join(format!(
        ".{}.{}.tmp",
        path.file_name().unwrap().to_string_lossy(),
        std::process::id()
    ));
    fs::write(&temporary, &zip).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    prune_diagnostics_archives(&dir);
    Ok(path)
}

/// Keep only the newest archives so repeated exports cannot fill the disk.
pub fn prune_diagnostics_archives(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut archives: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("zip")
                && path
                    .file_name()
                    .map(|name| name.to_string_lossy().starts_with("dsh-diagnostics-"))
                    .unwrap_or(false)
        })
        .collect();
    archives.sort();
    while archives.len() > DIAGNOSTIC_ARCHIVE_KEEP {
        let oldest = archives.remove(0);
        let _ = fs::remove_file(oldest);
    }
}

pub fn save_update_payload(user_data: &Path, params: &Value) -> Result<PathBuf, String> {
    let version = text_field(params, "version")?;
    let destination = params
        .get("destinationPath")
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            user_data
                .join("updates")
                .join(format!("DSH-Desktop-{version}.bin"))
        });
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = if let Some(text) = params.get("body").and_then(Value::as_str) {
        text.as_bytes().to_vec()
    } else if let Some(bytes) = params.get("bytes").and_then(Value::as_array) {
        bytes
            .iter()
            .filter_map(Value::as_u64)
            .map(|value| value as u8)
            .collect()
    } else {
        return Err("empty-body".into());
    };
    if body.is_empty() {
        return Err("empty-body".into());
    }
    if body.len() > 1024 * 1024 * 1024 {
        return Err("response-too-large".into());
    }
    fs::write(&destination, &body).map_err(|error| error.to_string())?;
    Ok(destination)
}

fn parse_update_outcome(params: &Value) -> Result<UpdateOutcome, String> {
    let status = params
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("up-to-date")
        .to_string();
    if status != "up-to-date" && status != "update-available" {
        return Err("invalid update status".into());
    }
    Ok(UpdateOutcome {
        status,
        current_version: text_field(params, "currentVersion").or_else(|_| text_field(params, "current_version"))?,
        latest_version: text_field(params, "latestVersion").or_else(|_| text_field(params, "latest_version"))?,
    })
}

pub(crate) enum RecoveryEffect {
    Restart,
    Quit,
    Diagnostics(PathBuf),
    Profile(String),
    Ignored,
}

pub fn apply_recovery_action(user_data: &Path, action: &RecoveryAction) -> Result<RecoveryEffect, String> {
    match action.action.as_str() {
        "restart" => Ok(RecoveryEffect::Restart),
        "quit" => Ok(RecoveryEffect::Quit),
        "save-diagnostics" => Ok(RecoveryEffect::Diagnostics(export_diagnostics_archive(
            user_data,
            "0.1.0",
            None,
        )?)),
        "add-profile" | "switch-profile" => {
            let name = action
                .name
                .clone()
                .ok_or_else(|| "profile name required".to_string())?;
            write_profile_state(
                &user_data.join("profile-selection").join("state.json"),
                &name,
            )?;
            let mode = bootstrap::load_native_bootstrap(user_data).mode;
            bootstrap::write_native_bootstrap(user_data, &name, &mode)
                .map_err(|error| error.to_string())?;
            Ok(RecoveryEffect::Profile(name))
        }
        _ => Ok(RecoveryEffect::Ignored),
    }
}

fn persist_profile_selection(user_data: &Path, name: &str) -> Result<Value, String> {
    write_profile_state(
        &user_data.join("profile-selection").join("state.json"),
        name,
    )?;
    let mode = bootstrap::load_native_bootstrap(user_data).mode;
    bootstrap::write_native_bootstrap(user_data, name, &mode).map_err(|error| error.to_string())?;
    let NativeBootstrap { profile_name, .. } = bootstrap::load_native_bootstrap(user_data);
    Ok(json!({ "ok": true, "profileName": profile_name }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn session() -> NativeSession {
        let dir = std::env::temp_dir().join(format!(
            "dsh-native-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        NativeSession::new(dir, "darwin")
    }

    #[test]
    fn stdio_request_line_upserts_tray() {
        let line = r#"{"v":1,"type":"req","id":"1","method":"shell.tray.upsert","params":{"id":"tray-1","group":"tools","order":10,"label":"Open Terminal","enabled":true}}"#;
        let decoded = crate::protocol::decode_message(line).unwrap();
        let crate::protocol::RpcMessage::Request { method, params, .. } = decoded else {
            panic!("production tray upsert must be a request, not an event");
        };
        let mut native = session();
        native.dispatch(&method, params.unwrap_or(json!({}))).unwrap();
        assert_eq!(native.listed_tray_ids(), vec!["tray-1".to_string()]);
    }

    #[test]
    fn open_devtools_returns_inspector_url() {
        let mut native = session();
        let result = native
            .dispatch(
                "shell.openDevtools",
                json!({ "origin": "http://127.0.0.1:9/", "tab": "network" }),
            )
            .unwrap();
        assert_eq!(result["url"], "http://127.0.0.1:9/_dsh/dev/ui?tab=network");
    }

    #[test]
    fn tray_upsert_parses_submenus() {
        let mut native = session();
        native
            .dispatch(
                "shell.tray.upsert",
                json!({
                    "id": "tray-2",
                    "group": "profiles",
                    "order": 5,
                    "label": "Profile: desktop",
                    "enabled": true,
                    "submenu": [
                        { "label": "desktop", "type": "radio", "checked": true },
                        { "label": "web", "type": "radio", "checked": false, "enabled": false },
                        { "label": "New Profile…" }
                    ]
                }),
            )
            .unwrap();
        let item = native.tray.iter().find(|item| item.id == "tray-2").unwrap();
        assert_eq!(item.submenu.len(), 3);
        assert_eq!(item.submenu[0].kind, "radio");
        assert!(item.submenu[0].checked);
        assert!(!item.submenu[1].enabled);
        assert_eq!(item.submenu[2].kind, "normal");
        let rejected = native.dispatch(
            "shell.tray.upsert",
            json!({
                "id": "tray-3",
                "group": "tools",
                "order": 1,
                "label": "bad",
                "submenu": [{ "label": "x", "type": "launcher" }]
            }),
        );
        assert!(rejected.is_err());
    }

    #[test]
    fn notify_attention_skips_while_focused_and_clears_on_demand() {
        let mut native = session();
        let first = native
            .dispatch("shell.notifyAttention", json!({ "title": "Job", "body": "done" }))
            .unwrap();
        assert_eq!(first["attention"], 1);
        assert!(first.get("skipped").is_none());
        native.focused = true;
        let skipped = native
            .dispatch("shell.notifyAttention", json!({ "title": "Job", "body": "again" }))
            .unwrap();
        assert_eq!(skipped["skipped"], true);
        assert_eq!(skipped["attention"], 1);
        assert_eq!(native.notifications.len(), 1);
        native.focused = false;
        assert!(native.clear_attention());
        assert_eq!(native.attention, 0);
        assert!(!native.clear_attention());
    }

    #[test]
    fn validate_directory_allows_off_windows_platforms() {
        let mut native = session();
        let result = native
            .dispatch("shell.validateDirectory", json!({ "path": "/Users/me/proj" }))
            .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["decision"], "allow");
    }

    #[test]
    fn terminal_launch_rejects_linux() {
        let mut native = NativeSession::new(
            std::env::temp_dir().join(format!(
                "dsh-native-linux-{}",
                SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
            )),
            "linux",
        );
        let rejected = native.dispatch(
            "shell.openTerminal",
            json!({
                "profileName": "desktop",
                "profileDir": "/tmp/profile",
                "homeDir": "/tmp/home"
            }),
        );
        assert!(rejected.is_err());
        let message = rejected.unwrap_err();
        assert!(message.contains("linux"));
    }

    #[test]
    fn terminal_launch_forwards_cwd_and_environment() {
        let mut native = session();
        let result = native
            .dispatch(
                "shell.openTerminal",
                json!({
                    "profileName": "desktop",
                    "profileDir": "/tmp/profile",
                    "homeDir": "/tmp/home",
                    "command": ["C:\\Windows\\System32\\cmd.exe", "/D", "/S", "/C", "launch.cmd"],
                    "cwd": "/state/dir",
                    "environment": { "DSH_HOME": "/tmp/home", "PATH": "/shim;C:\\Windows" }
                }),
            )
            .unwrap();
        assert_eq!(result["cwd"], "/state/dir");
        assert_eq!(result["environment"]["DSH_HOME"], "/tmp/home");
        assert_eq!(result["environment"]["PATH"], "/shim;C:\\Windows");
    }

    #[test]
    fn terminal_launch_error_dialog_copy_matches_upstream() {
        let en = terminal_launch_error_dialog("en", "spawn failed");
        assert_eq!(en["title"], "Unable to Open DSH Terminal");
        assert_eq!(en["message"], "DSH Desktop could not open a terminal.");
        assert_eq!(en["detail"], "spawn failed");
        assert_eq!(en["buttons"][0], "OK");
        assert_eq!(en["defaultId"], 0);
        assert_eq!(en["cancelId"], 0);
        let zh = terminal_launch_error_dialog("zh", "spawn failed");
        assert_eq!(zh["title"], "无法打开 DSH 终端");
        assert_eq!(zh["message"], "DSH Desktop 无法打开终端。");
        assert_eq!(zh["buttons"][0], "确定");
    }

    #[test]
    fn tray_upsert_is_retained_and_listed() {
        let mut native = session();
        let result = native
            .dispatch(
                "shell.tray.upsert",
                json!({ "id": "tray-1", "group": "tools", "order": 2, "label": "Open Terminal", "enabled": true }),
            )
            .unwrap();
        assert_eq!(result["ids"][0], "tray-1");
        assert_eq!(native.listed_tray_ids(), vec!["tray-1".to_string()]);
        native
            .dispatch("shell.tray.remove", json!({ "id": "tray-1" }))
            .unwrap();
        assert!(native.listed_tray_ids().is_empty());
    }

    #[test]
    fn diagnostics_write_produces_zip() {
        let mut native = session();
        fs::create_dir_all(native.user_data.join("logs")).unwrap();
        fs::write(native.user_data.join("logs").join("dsh-2026-08-26.log"), "boot ok").unwrap();
        // Unrelated log file names are excluded by the upstream filter.
        fs::write(native.user_data.join("logs").join("notes.log"), "excluded").unwrap();
        let result = native.dispatch("shell.exportDiagnostics", json!({})).unwrap();
        let path = PathBuf::from(result["path"].as_str().unwrap());
        let bytes = fs::read(&path).unwrap();
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("system-info.txt"));
        assert!(text.contains("dsh-2026-08-26.log"));
        assert!(text.contains("boot ok"));
        assert!(!text.contains("notes.log"));
        assert!(!text.contains("excluded"));
    }

    #[test]
    fn diagnostics_archive_carries_upstream_system_info_and_prunes_old_archives() {
        let mut native = session();
        let diagnostics = native.user_data.join("diagnostics");
        fs::create_dir_all(&diagnostics).unwrap();
        for index in 0..3 {
            fs::write(
                diagnostics.join(format!("dsh-diagnostics-{index:020}.zip")),
                b"old",
            )
            .unwrap();
        }
        fs::create_dir_all(native.user_data.join("lifecycle-events")).unwrap();
        fs::write(
            native.user_data.join("lifecycle-events").join("startup.jsonl"),
            "{\"stage\":\"renderer-startup\"}",
        )
        .unwrap();
        let path = export_diagnostics_archive(&native.user_data, "1.2.3", Some("22.20.0")).unwrap();
        let bytes = fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("app: dsh-plugin-desktop"));
        assert!(text.contains("desktop-version: 1.2.3"));
        assert!(text.contains(&format!("platform: {}", std::env::consts::OS)));
        assert!(text.contains(&format!("arch: {}", std::env::consts::ARCH)));
        assert!(text.contains("node: 22.20.0"));
        assert!(text.contains("exported: "));
        assert!(text.contains("lifecycle-events/startup.jsonl"));
        let remaining = fs::read_dir(&diagnostics)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("dsh-diagnostics-")
            })
            .count();
        assert_eq!(remaining, 3);
    }

    #[test]
    fn reveal_item_records_exported_diagnostics_path() {
        let mut native = session();
        let result = native
            .dispatch(
                "shell.revealItem",
                json!({ "path": "/tmp/dsh-diagnostics.zip" }),
            )
            .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(
            native.last_revealed.as_deref(),
            Some(Path::new("/tmp/dsh-diagnostics.zip"))
        );
    }

    #[test]
    fn dsh_log_name_filter_matches_upstream_pattern() {
        assert!(is_dsh_log_file_name("dsh-2026-08-26.log"));
        assert!(is_dsh_log_file_name("dsh-2026-08-26.error.log"));
        assert!(is_dsh_log_file_name("dsh-2026-08-26.1.log"));
        assert!(is_dsh_log_file_name("dsh-2026-08-26.error.2.log"));
        assert!(!is_dsh_log_file_name("dsh.log"));
        assert!(!is_dsh_log_file_name("dsh-2026-8-6.log"));
        assert!(!is_dsh_log_file_name("dsh-2026-08-26.txt"));
        assert!(!is_dsh_log_file_name("notes.log"));
        assert!(!is_dsh_log_file_name("dsh-2026-08-26.error.2.extra.log"));
    }

    #[test]
    fn terminal_launch_is_recorded() {
        let mut native = session();
        let result = native
            .dispatch(
                "shell.openTerminal",
                json!({
                    "profileName": "desktop",
                    "profileDir": "/tmp/profile",
                    "homeDir": "/tmp/home"
                }),
            )
            .unwrap();
        assert_eq!(result["command"][0], "open");
        let record = fs::read_to_string(result["recordPath"].as_str().unwrap()).unwrap();
        assert!(record.contains("\"profileName\": \"desktop\""));
        let script_path = PathBuf::from(result["scriptPath"].as_str().unwrap());
        assert_eq!(
            script_path.extension().and_then(|ext| ext.to_str()),
            Some("command")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&script_path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
        }
    }

    #[test]
    fn terminal_launch_chmods_host_welcome_command() {
        let mut native = session();
        let welcome = native.user_data.join("cli").join("welcome.command");
        fs::create_dir_all(welcome.parent().unwrap()).unwrap();
        fs::write(&welcome, "#!/bin/sh\nexec \"$SHELL\" -i\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&welcome).unwrap().permissions();
            permissions.set_mode(0o600);
            fs::set_permissions(&welcome, permissions).unwrap();
        }
        let result = native
            .dispatch(
                "shell.openTerminal",
                json!({
                    "profileName": "desktop",
                    "profileDir": "/tmp/profile",
                    "homeDir": "/tmp/home",
                    "scriptPath": welcome,
                    "command": ["open", "-a", "Terminal", welcome]
                }),
            )
            .unwrap();
        assert_eq!(result["command"][3], welcome.to_string_lossy().as_ref());
        assert_eq!(result["scriptPath"], welcome.to_string_lossy().as_ref());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&welcome).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
        }
    }

    #[test]
    fn notification_and_attention_are_queued() {
        let mut native = session();
        native
            .dispatch("shell.notify", json!({ "title": "Ready", "body": "Host mounted" }))
            .unwrap();
        native
            .dispatch("shell.notifyAttention", json!({ "title": "Job", "body": "done" }))
            .unwrap();
        assert_eq!(native.notifications.len(), 2);
        assert_eq!(native.attention, 1);
    }

    #[test]
    fn update_download_writes_payload() {
        let mut native = session();
        native
            .dispatch(
                "shell.showUpdateResult",
                json!({
                    "status": "update-available",
                    "currentVersion": "0.1.0",
                    "latestVersion": "0.2.0"
                }),
            )
            .unwrap();
        let result = native
            .dispatch(
                "shell.downloadUpdate",
                json!({ "version": "0.2.0", "body": "installer-bytes" }),
            )
            .unwrap();
        let path = PathBuf::from(result["path"].as_str().unwrap());
        assert_eq!(fs::read_to_string(path).unwrap(), "installer-bytes");
        assert_eq!(native.last_update.as_ref().unwrap().status, "update-available");
    }

    #[test]
    fn recovery_profile_action_persists_state() {
        let mut native = session();
        let result = native
            .dispatch(
                "shell.openRecovery",
                json!({ "href": "dsh-recovery://switch-profile?name=web" }),
            )
            .unwrap();
        assert_eq!(result["profileName"], "web");
        let state = fs::read_to_string(native.user_data.join("profile-selection").join("state.json")).unwrap();
        assert!(state.contains("\"active\": \"web\""));
        let bootstrap = fs::read_to_string(native.user_data.join("native-bootstrap.json")).unwrap();
        assert!(bootstrap.contains("\"profileName\": \"web\""));
    }

    #[test]
    fn dialog_href_returns_bounded_id() {
        let mut native = session();
        let result = native
            .dispatch(
                "shell.openDialog",
                json!({
                    "href": "dsh-desktop-dialog://response?id=1",
                    "buttons": ["Keep", "Replace"]
                }),
            )
            .unwrap();
        assert_eq!(result["response"], 1);
        let rejected = native.dispatch(
            "shell.openDialog",
            json!({
                "href": "dsh-desktop-dialog://response?id=1&command=bad",
                "buttons": ["Keep", "Replace"]
            }),
        );
        assert!(rejected.is_err());
    }

    #[test]
    fn drop_paths_and_external_links_via_dispatch() {
        let mut native = session();
        let drop = native
            .dispatch(
                "shell.dropPaths",
                json!({ "paths": ["/Users/me/proj"], "x": 12.0, "y": 40.0 }),
            )
            .unwrap();
        let script = drop["script"].as_str().unwrap();
        assert!(script.contains("dsh-desktop-folder-drop"));
        assert!(script.contains("/Users/me/proj"));
        assert_eq!(native.last_drop_script.as_deref(), Some(script));
        let https = native
            .dispatch(
                "shell.openExternal",
                json!({ "origin": "http://127.0.0.1:9/", "href": "https://example.com/docs" }),
            )
            .unwrap();
        assert_eq!(https["external"], true);
        let loopback = native
            .dispatch(
                "shell.openExternal",
                json!({ "origin": "http://127.0.0.1:9/", "href": "http://127.0.0.1:9/app" }),
            )
            .unwrap();
        assert_eq!(loopback["external"], false);
        let mailto = native
            .dispatch(
                "shell.openExternal",
                json!({ "origin": "http://127.0.0.1:9/", "href": "mailto:ops@example.com" }),
            )
            .unwrap();
        assert_eq!(mailto["external"], true);
    }

    #[test]
    fn mount_records_chrome_plan() {
        let mut native = session();
        native
            .dispatch(
                "shell.schedule",
                json!({
                    "mode": "advanced",
                    "material": "transparent",
                    "width": 1280,
                    "height": 800,
                    "minWidth": 900,
                    "minHeight": 600,
                    "url": "http://127.0.0.1:9/",
                    "productName": "DSH Desktop",
                    "windowTitle": "DSH Desktop",
                    "themeSource": "system"
                }),
            )
            .unwrap();
        native.dispatch("shell.mount", json!({ "generationId": "g1" })).unwrap();
        let plan = native.last_plan.unwrap();
        assert_eq!(plan.mode, "advanced");
        assert_eq!(plan.chrome.titlebar_height, 32);
        assert!(plan.intercept_external_links);
    }
}
