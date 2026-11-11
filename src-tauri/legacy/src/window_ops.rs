use crate::materials::effective_material;
use crate::window_spec::{chrome_for_mode, linux_forces_compatibility, WindowChrome};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WindowApplyPlan {
    pub mode: String,
    pub chrome: WindowChrome,
    pub material: String,
    pub zoom_level: i32,
    pub intercept_external_links: bool,
    pub bounds: Option<WindowBounds>,
}

#[derive(Serialize, Deserialize)]
struct BoundsDocument {
    version: u8,
    bounds: WindowBounds,
}

pub fn clamp_zoom(level: i32) -> i32 {
    level.clamp(-4, 4)
}

pub fn apply_zoom_delta(current: i32, delta: i32) -> i32 {
    clamp_zoom(current + delta)
}

pub fn next_window_maximized(currently_maximized: bool) -> bool {
    !currently_maximized
}

/// Visual height of the macOS traffic-light control, matching Electron's 36px frame math.
pub const MACOS_TRAFFIC_LIGHT_BUTTON_HEIGHT: f64 = 12.0;
pub const MACOS_TRAFFIC_LIGHT_X: f64 = 16.0;

/// Tauri/wry sets the native titlebar container height to `button_height + inset.y`.
/// Use this inset so the container matches the CSS frame instead of a ~26px strip.
pub fn macos_traffic_light_wry_inset_y(titlebar_height: u32) -> f64 {
    (f64::from(titlebar_height) - MACOS_TRAFFIC_LIGHT_BUTTON_HEIGHT).max(0.0)
}

/// NSView origin.y (bottom-left) that vertically centers a traffic-light button in the frame.
pub fn macos_traffic_light_button_origin_y(titlebar_height: u32, button_height: f64) -> f64 {
    ((f64::from(titlebar_height) - button_height) / 2.0).max(0.0)
}

/// Electron `applicationNeedsReveal`: Dock / activate must not steal focus when
/// the window is already in front. Hidden, minimized, or a hidden macOS app must reveal.
pub fn application_needs_reveal(
    visible: bool,
    minimized: bool,
    app_hidden: bool,
    platform: &str,
) -> bool {
    minimized || !visible || (platform == "darwin" && app_hidden)
}

/// Electron hiddenInset + `-webkit-app-region: drag` zooms on titlebar double-click.
/// The injected script inlines this policy; the function is the testable contract.
#[allow(dead_code)]
pub fn should_handle_titlebar_dblclick(
    client_y: f64,
    titlebar_height: u32,
    interactive: bool,
    in_titlebar_region: bool,
) -> bool {
    if interactive {
        return false;
    }
    if in_titlebar_region {
        return true;
    }
    client_y >= 0.0 && client_y <= f64::from(titlebar_height)
}

/// Marks official DSH titlebar as a Tauri drag region (so native dblclick zoom works)
/// and falls back to `toggle_maximize` for unmarked top chrome.
pub const TITLEBAR_DBLCLICK_SCRIPT: &str = r#"(function () {
  if (window.__DSH_TITLEBAR_ZOOM__) return;
  window.__DSH_TITLEBAR_ZOOM__ = true;
  var TITLEBAR = '[data-dsh-desktop-frame="titlebar"], .dshDesktopFrameTitlebar, .dshDesktopMacCaptionRow, .dshDesktopWindowsCaptionRow';
  var INTERACTIVE = 'button, a, input, textarea, select, label, summary, [contenteditable="true"], [role="button"], [role="checkbox"], [role="dialog"], [role="menuitem"], [role="option"], [role="switch"], [role="tab"], [role="menu"], .dshDesktopNativeActions, .dshDesktopFrameActions, .dshDesktopNoDrag, .dshDesktopTitlebarIconButton, .dshDesktopFrameVersion, .dshDesktopFrameMode';
  function mark(root) {
    if (!root || root.nodeType !== 1) return;
    var nodes = [];
    if (root.matches && root.matches(TITLEBAR)) nodes.push(root);
    if (root.querySelectorAll) {
      var found = root.querySelectorAll(TITLEBAR);
      for (var i = 0; i < found.length; i++) nodes.push(found[i]);
    }
    for (var j = 0; j < nodes.length; j++) {
      if (!nodes[j].hasAttribute('data-tauri-drag-region')) {
        nodes[j].setAttribute('data-tauri-drag-region', 'deep');
      }
    }
  }
  mark(document.documentElement);
  try {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) mark(added[j]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (error) {}
  document.addEventListener('dblclick', function (event) {
    var node = event.target;
    if (!node || !node.closest) return;
    if (node.closest(INTERACTIVE)) return;
    if (node.closest('[data-tauri-drag-region]')) return;
    var inTitlebar = !!node.closest(TITLEBAR);
    var y = event.clientY;
    if (!inTitlebar && (y < 0 || y > 36)) return;
    var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (typeof invoke !== 'function') return;
    event.preventDefault();
    invoke('toggle_maximize');
  }, true);
})();"#;

pub fn origin_of(href: &str) -> Option<String> {
    let scheme_end = href.find("://")?;
    let scheme = &href[..scheme_end];
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let rest = &href[scheme_end + 3..];
    let hostport = rest.split('/').next().unwrap_or(rest);
    if hostport.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{hostport}"))
}

pub fn is_loopback_href(href: &str) -> bool {
    href.starts_with("http://127.0.0.1")
        || href.starts_with("http://[::1]")
        || href.starts_with("http://localhost")
}

pub fn should_open_externally(page_origin: &str, href: &str) -> bool {
    if href.starts_with("mailto:") {
        return true;
    }
    if is_loopback_href(href) {
        return false;
    }
    let Some(target) = origin_of(href) else {
        return false;
    };
    let Some(page) = origin_of(page_origin) else {
        return true;
    };
    target != page
}

pub fn open_external_href(
    page_origin: &str,
    href: &str,
    opener: impl FnOnce(&str) -> Result<(), String>,
) -> Result<bool, String> {
    if !should_open_externally(page_origin, href) {
        return Ok(false);
    }
    opener(href)?;
    Ok(true)
}

pub fn folder_drop_script(paths: &[String], x: f64, y: f64) -> String {
    let detail = serde_json::json!({ "paths": paths, "x": x, "y": y });
    format!("window.dispatchEvent(new CustomEvent('dsh-desktop-folder-drop', {{ detail: {detail} }}));")
}

/// Bridge `window.__DSH_DESKTOP_FILE_PATH__.getPathForFile(file)` on every page
/// (loopback and official client): the native drop script dispatches the
/// `dsh-desktop-folder-drop` CustomEvent, and the next HTML5 drop handler can
/// read the single directory path back.
pub const FILE_PATH_BRIDGE_SCRIPT: &str = r#"(function () {
  if (window.__DSH_DESKTOP_FILE_PATH__) return;
  var state = { lastDropPaths: [] };
  window.addEventListener('dsh-desktop-folder-drop', function (event) {
    var detail = event.detail || {};
    state.lastDropPaths = detail.paths || [];
  }, true);
  window.__DSH_DESKTOP_FILE_PATH__ = {
    getPathForFile: function () {
      return state.lastDropPaths.length === 1 ? state.lastDropPaths[0] : '';
    }
  };
})();"#;

/// Gate for the keyboard zoom shortcuts: keyDown only, control or meta held,
/// alt excluded; `+`/`=` zooms in, `-`/`_` zooms out, `0` resets.
/// The injected script inlines this policy; the function is the tested contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum ZoomShortcut {
    ZoomIn,
    ZoomOut,
    Reset,
}

#[allow(dead_code)]
pub fn zoom_shortcut(key: &str, control: bool, meta: bool, alt: bool, key_down: bool) -> Option<ZoomShortcut> {
    if !key_down || alt || (!control && !meta) {
        return None;
    }
    match key {
        "+" | "=" => Some(ZoomShortcut::ZoomIn),
        "-" | "_" => Some(ZoomShortcut::ZoomOut),
        "0" => Some(ZoomShortcut::Reset),
        _ => None,
    }
}

/// Injected page script that forwards zoom shortcuts to the `zoom_change` command.
pub const ZOOM_SHORTCUT_SCRIPT: &str = r#"(function () {
  if (window.__DSH_ZOOM_SHORTCUTS__) return;
  window.__DSH_ZOOM_SHORTCUTS__ = true;
  document.addEventListener('keydown', function (event) {
    if (event.altKey) return;
    if (!event.ctrlKey && !event.metaKey) return;
    var delta = null;
    var key = event.key;
    if (key === '+' || key === '=') delta = 1;
    else if (key === '-' || key === '_') delta = -1;
    else if (key === '0') delta = 0;
    if (delta === null) return;
    var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
    if (typeof invoke !== 'function') return;
    event.preventDefault();
    invoke('zoom_change', { delta: delta });
  }, true);
})();"#;

/// Fullscreen enter/exit sequencing for close-hide and reveal, ported from the
/// upstream `fullscreenExitPending` / `hideAfterFullscreenExit` /
/// `restoreFullscreenOnShow` lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClosePlan {
    /// Hide the window immediately.
    Hide,
    /// Request a fullscreen exit first; the hide happens on `leave-fullscreen`.
    ExitFullscreenThenHide,
    /// A fullscreen exit is already in flight; only arm the pending hide.
    WaitForFullscreenExit,
    /// Quitting: allow the real close.
    AllowClose,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaveFullscreenAction {
    Hide,
    Refullscreen,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShowAction {
    EnterFullscreen,
    None,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FullscreenHideState {
    pub fullscreen_exit_pending: bool,
    pub hide_after_exit: bool,
    pub refullscreen_after_exit: bool,
    pub restore_on_show: bool,
}

impl FullscreenHideState {
    pub fn on_close(&mut self, is_fullscreen: bool, quitting: bool) -> ClosePlan {
        if quitting {
            return ClosePlan::AllowClose;
        }
        if is_fullscreen && self.fullscreen_exit_pending {
            self.hide_after_exit = true;
            return ClosePlan::WaitForFullscreenExit;
        }
        if is_fullscreen {
            self.fullscreen_exit_pending = true;
            self.hide_after_exit = true;
            self.restore_on_show = true;
            return ClosePlan::ExitFullscreenThenHide;
        }
        ClosePlan::Hide
    }

    pub fn on_leave_fullscreen(&mut self) -> LeaveFullscreenAction {
        if !self.fullscreen_exit_pending {
            return LeaveFullscreenAction::None;
        }
        self.fullscreen_exit_pending = false;
        if self.refullscreen_after_exit {
            self.refullscreen_after_exit = false;
            self.restore_on_show = false;
            return LeaveFullscreenAction::Refullscreen;
        }
        if self.hide_after_exit {
            self.hide_after_exit = false;
            return LeaveFullscreenAction::Hide;
        }
        LeaveFullscreenAction::None
    }

    pub fn on_show(&mut self) -> ShowAction {
        if !self.restore_on_show {
            return ShowAction::None;
        }
        if self.fullscreen_exit_pending {
            // The exit is still finishing: flip the pending hide into a re-enter.
            self.hide_after_exit = false;
            self.refullscreen_after_exit = true;
            return ShowAction::None;
        }
        self.restore_on_show = false;
        ShowAction::EnterFullscreen
    }
}

pub fn persist_window_bounds(user_data: &Path, bounds: &WindowBounds) -> Result<(), String> {
    fs::create_dir_all(user_data).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::metadata(user_data)
            .map_err(|error| error.to_string())?
            .permissions();
        if permissions.mode() & 0o777 != 0o700 {
            let mut updated = permissions;
            updated.set_mode(0o700);
            fs::set_permissions(user_data, updated).map_err(|error| error.to_string())?;
        }
    }
    let document = BoundsDocument {
        version: 1,
        bounds: bounds.clone(),
    };
    let text = format!(
        "{}\n",
        serde_json::to_string_pretty(&document).map_err(|error| error.to_string())?
    );
    if text.len() > WINDOW_STATE_MAX_BYTES {
        return Err("main-window state exceeds 4096 bytes".into());
    }
    let temporary = user_data.join(format!(
        ".main-window-state.json.{}.{}.tmp",
        std::process::id(),
        uuid_for_state()
    ));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::write(&temporary, &text).map_err(|error| error.to_string())?;
        let mut permissions = fs::metadata(&temporary)
            .map_err(|error| error.to_string())?
            .permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&temporary, permissions).map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&temporary, &text).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary, user_data.join("main-window-state.json")).map_err(|error| error.to_string())?;
    Ok(())
}

fn uuid_for_state() -> String {
    let stamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    stamp.to_le_bytes().iter().map(|byte| format!("{byte:02x}")).collect()
}

pub const WINDOW_STATE_MAX_BYTES: usize = 4096;

/// Compare two window rectangles without relying on identity.
pub fn same_window_bounds(left: &WindowBounds, right: &WindowBounds) -> bool {
    left == right
}

/// Load the persisted main window state. Missing files yield `Ok(None)`;
/// damaged or oversized state surfaces the upstream error strings so callers
/// can log and fall back to the default geometry.
pub fn load_window_bounds(user_data: &Path) -> Result<Option<WindowBounds>, String> {
    let path = user_data.join("main-window-state.json");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(None),
    };
    if !metadata.is_file() {
        return Err("main-window state must be a regular file".into());
    }
    if metadata.len() as usize > WINDOW_STATE_MAX_BYTES {
        return Err("main-window state exceeds 4096 bytes".into());
    }
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let document: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "main-window state is invalid".to_string())?;
    if document.get("version").and_then(serde_json::Value::as_u64) != Some(1) {
        return Err("main-window state has an unsupported version".into());
    }
    let Some(bounds) = document.get("bounds") else {
        return Err("main-window state is invalid".into());
    };
    let read_i32 = |key: &str| -> Result<i32, String> {
        let value = bounds
            .get(key)
            .ok_or_else(|| "coordinates must be safe integers".to_string())?;
        if !value.is_i64() && !value.is_u64() {
            return Err("coordinates must be safe integers".into());
        }
        value
            .as_i64()
            .and_then(|number| i32::try_from(number).ok())
            .ok_or_else(|| "coordinates must be safe integers".to_string())
    };
    let read_positive = |key: &str| -> Result<u32, String> {
        let value = read_i32(key).map_err(|_| "dimensions must be positive safe integers".to_string())?;
        if value <= 0 {
            return Err("dimensions must be positive safe integers".into());
        }
        Ok(value as u32)
    };
    let x = read_i32("x")?;
    let y = read_i32("y")?;
    let width = read_positive("width")?;
    let height = read_positive("height")?;
    Ok(Some(WindowBounds { x, y, width, height }))
}

/// Keep a restored rectangle usable when monitor layout or work area changed:
/// clamp the size into the work area, keep reachable windows untouched, and
/// pull everything else back inside. Ported from the upstream product math.
pub fn fit_main_window_bounds(
    bounds: WindowBounds,
    work_area: WindowBounds,
    minimum: (u32, u32),
) -> WindowBounds {
    let min_width = minimum.0.max(1);
    let min_height = minimum.1.max(1);
    let width = min_width.max(bounds.width.min(work_area.width));
    let height = min_height.max(bounds.height.min(work_area.height));
    let visible_width = 0i64.max(
        (i64::from(bounds.x) + i64::from(width)).min(i64::from(work_area.x) + i64::from(work_area.width))
            - i64::from(bounds.x).max(i64::from(work_area.x)),
    );
    let top_edge_is_reachable = i64::from(bounds.y) >= i64::from(work_area.y) - 32
        && i64::from(bounds.y) < i64::from(work_area.y) + i64::from(work_area.height) - 36;
    if width == bounds.width && height == bounds.height && visible_width >= 64.min(i64::from(width)) && top_edge_is_reachable
    {
        return bounds;
    }
    let max_x = i64::from(work_area.x) + 0.max(i64::from(work_area.width) - i64::from(width));
    let max_y = i64::from(work_area.y) + 0.max(i64::from(work_area.height) - i64::from(height));
    let x = max_x.min(i64::from(work_area.x).max(i64::from(bounds.x)));
    let y = max_y.min(i64::from(work_area.y).max(i64::from(bounds.y)));
    WindowBounds {
        x: x as i32,
        y: y as i32,
        width,
        height,
    }
}

pub fn plan_generation(
    platform: &str,
    requested_mode: &str,
    macos_material: &str,
    windows_material: &str,
    windows_build: Option<u32>,
    zoom: i32,
    bounds: Option<WindowBounds>,
) -> WindowApplyPlan {
    let mode = if linux_forces_compatibility(platform, requested_mode) {
        "compatibility"
    } else {
        requested_mode
    };
    WindowApplyPlan {
        mode: mode.to_string(),
        chrome: chrome_for_mode(mode),
        material: effective_material(platform, mode, macos_material, windows_material, windows_build)
            .to_string(),
        zoom_level: apply_zoom_delta(0, zoom),
        intercept_external_links: true,
        bounds,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn traffic_lights_center_in_the_36px_frame() {
        assert_eq!(macos_traffic_light_wry_inset_y(36), 24.0);
        assert_eq!(macos_traffic_light_button_origin_y(36, 12.0), 12.0);
        assert_eq!(macos_traffic_light_button_origin_y(36, 14.0), 11.0);
        assert_eq!(macos_traffic_light_wry_inset_y(32), 20.0);
        assert_eq!(macos_traffic_light_button_origin_y(32, 12.0), 10.0);
    }

    #[test]
    fn dock_activate_reveals_hidden_or_minimized_macos_window() {
        assert!(application_needs_reveal(false, false, false, "darwin"));
        assert!(application_needs_reveal(true, true, false, "darwin"));
        assert!(application_needs_reveal(true, false, true, "darwin"));
        assert!(!application_needs_reveal(true, false, false, "darwin"));
        assert!(!application_needs_reveal(true, false, true, "win32"));
        assert!(application_needs_reveal(false, false, true, "win32"));
    }

    #[test]
    fn titlebar_dblclick_zooms_and_skips_controls() {
        assert!(should_handle_titlebar_dblclick(12.0, 36, false, true));
        assert!(!should_handle_titlebar_dblclick(12.0, 36, true, true));
        assert!(should_handle_titlebar_dblclick(8.0, 36, false, false));
        assert!(!should_handle_titlebar_dblclick(80.0, 36, false, false));
        assert!(next_window_maximized(false));
        assert!(!next_window_maximized(true));
        assert!(TITLEBAR_DBLCLICK_SCRIPT.contains("toggle_maximize"));
        assert!(TITLEBAR_DBLCLICK_SCRIPT.contains("data-tauri-drag-region"));
        assert!(TITLEBAR_DBLCLICK_SCRIPT.contains("dshDesktopFrameTitlebar"));
        assert!(TITLEBAR_DBLCLICK_SCRIPT.contains("INTERACTIVE"));
    }

    #[test]
    fn linux_advanced_falls_back_to_compatibility_off() {
        let plan = plan_generation("linux", "advanced", "transparent", "mica", None, 0, None);
        assert_eq!(plan.mode, "compatibility");
        assert_eq!(plan.chrome.titlebar_height, 36);
        assert_eq!(plan.material, "off");
        assert!(plan.intercept_external_links);
    }

    #[test]
    fn advanced_macos_uses_compact_caption() {
        let plan = plan_generation("darwin", "advanced", "transparent", "off", None, 9, None);
        assert_eq!(plan.chrome.titlebar_height, 32);
        assert_eq!(plan.chrome.macos_traffic_light_top, 16);
        assert_eq!(plan.material, "transparent");
        assert_eq!(plan.zoom_level, 4);
        assert_eq!(apply_zoom_delta(3, 2), 4);
        assert_eq!(apply_zoom_delta(-3, -2), -4);
    }

    #[test]
    fn drop_script_forwards_native_path() {
        let script = folder_drop_script(&["/Users/me/proj".into()], 12.0, 40.0);
        assert!(script.contains("dsh-desktop-folder-drop"));
        assert!(script.contains("/Users/me/proj"));
        assert!(script.contains("12"));
    }

    #[test]
    fn external_links_leave_loopback_origin() {
        assert!(should_open_externally(
            "http://127.0.0.1:9/",
            "https://example.com/docs"
        ));
        assert!(!should_open_externally(
            "http://127.0.0.1:9/",
            "http://127.0.0.1:9/app"
        ));
        assert!(should_open_externally("http://127.0.0.1:9/", "mailto:ops@example.com"));
        assert!(!should_open_externally("tauri://localhost/", "http://127.0.0.1:9/"));
        let mut opened = Vec::new();
        assert!(open_external_href(
            "http://127.0.0.1:9/",
            "https://example.com/docs",
            |url| {
                opened.push(url.to_string());
                Ok(())
            },
        )
        .unwrap());
        assert_eq!(opened, vec!["https://example.com/docs".to_string()]);
        assert!(!open_external_href(
            "http://127.0.0.1:9/",
            "http://127.0.0.1:9/app",
            |_| Err("must not open loopback".into()),
        )
        .unwrap());
    }

    #[test]
    fn window_bounds_round_trip() {
        let dir = std::env::temp_dir().join(format!(
            "dsh-bounds-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        persist_window_bounds(
            &dir,
            &WindowBounds {
                x: 12,
                y: 24,
                width: 1280,
                height: 800,
            },
        )
        .unwrap();
        let loaded = load_window_bounds(&dir).unwrap().unwrap();
        assert_eq!(loaded.width, 1280);
        assert_eq!(loaded.x, 12);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.join("main-window-state.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
        // No leftover temporary files once the rename lands.
        let leftovers = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".main-window-state.json.")
            })
            .count();
        assert_eq!(leftovers, 0);
        assert!(same_window_bounds(
            &loaded,
            &WindowBounds {
                x: 12,
                y: 24,
                width: 1280,
                height: 800
            }
        ));
    }

    #[test]
    fn window_bounds_rejects_damaged_state() {
        let dir = std::env::temp_dir().join(format!(
            "dsh-bounds-bad-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        // Missing file: Ok(None).
        assert!(load_window_bounds(&dir).unwrap().is_none());
        // Symlink: rejected.
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = dir.join("state.json");
            fs::write(&target, "{}\n").unwrap();
            let link = dir.join("main-window-state.json");
            let _ = fs::remove_file(&link);
            symlink(&target, &link).unwrap();
            assert_eq!(
                load_window_bounds(&dir).unwrap_err(),
                "main-window state must be a regular file"
            );
            let _ = fs::remove_file(&link);
        }
        // Oversized: rejected.
        fs::write(
            dir.join("main-window-state.json"),
            format!("{{\"padding\":\"{}\"}}", "x".repeat(4200)),
        )
        .unwrap();
        assert_eq!(
            load_window_bounds(&dir).unwrap_err(),
            "main-window state exceeds 4096 bytes"
        );
        // Unsupported version.
        fs::write(
            dir.join("main-window-state.json"),
            "{\"version\":2,\"bounds\":{\"x\":0,\"y\":0,\"width\":10,\"height\":10}}\n",
        )
        .unwrap();
        assert_eq!(
            load_window_bounds(&dir).unwrap_err(),
            "main-window state has an unsupported version"
        );
        // Zero dimensions: rejected.
        fs::write(
            dir.join("main-window-state.json"),
            "{\"version\":1,\"bounds\":{\"x\":0,\"y\":0,\"width\":0,\"height\":10}}\n",
        )
        .unwrap();
        assert_eq!(
            load_window_bounds(&dir).unwrap_err(),
            "dimensions must be positive safe integers"
        );
        // Non-integer coordinates: rejected.
        fs::write(
            dir.join("main-window-state.json"),
            "{\"version\":1,\"bounds\":{\"x\":1.5,\"y\":0,\"width\":10,\"height\":10}}\n",
        )
        .unwrap();
        assert_eq!(
            load_window_bounds(&dir).unwrap_err(),
            "coordinates must be safe integers"
        );
    }

    #[test]
    fn fit_matches_the_upstream_monitor_math() {
        let work_area = WindowBounds {
            x: -1440,
            y: 24,
            width: 1440,
            height: 876,
        };
        let minimum = (900u32, 600u32);
        // Reachable side-monitor windows stay untouched.
        assert_eq!(
            fit_main_window_bounds(
                WindowBounds {
                    x: -1320,
                    y: 80,
                    width: 1280,
                    height: 760
                },
                work_area.clone(),
                minimum
            ),
            WindowBounds {
                x: -1320,
                y: 80,
                width: 1280,
                height: 760
            }
        );
        assert_eq!(
            fit_main_window_bounds(
                WindowBounds {
                    x: -1448,
                    y: 0,
                    width: 1280,
                    height: 760
                },
                work_area.clone(),
                minimum
            ),
            WindowBounds {
                x: -1448,
                y: 0,
                width: 1280,
                height: 760
            }
        );
        // Detached oversized rectangles are pulled back into the work area.
        assert_eq!(
            fit_main_window_bounds(
                WindowBounds {
                    x: 4200,
                    y: -800,
                    width: 2000,
                    height: 1400
                },
                work_area.clone(),
                minimum
            ),
            WindowBounds {
                x: -1440,
                y: 24,
                width: 1440,
                height: 876
            }
        );
        // Sizes never drop below the minimum.
        assert_eq!(
            fit_main_window_bounds(
                WindowBounds {
                    x: -1400,
                    y: 100,
                    width: 300,
                    height: 200
                },
                work_area.clone(),
                minimum
            )
            .width,
            900
        );
    }

    #[test]
    fn zoom_shortcut_gates_keys_and_modifiers() {
        use ZoomShortcut::*;
        assert_eq!(zoom_shortcut("+", true, false, false, true), Some(ZoomIn));
        assert_eq!(zoom_shortcut("=", false, true, false, true), Some(ZoomIn));
        assert_eq!(zoom_shortcut("-", true, false, false, true), Some(ZoomOut));
        assert_eq!(zoom_shortcut("_", false, true, false, true), Some(ZoomOut));
        assert_eq!(zoom_shortcut("0", true, false, false, true), Some(Reset));
        assert_eq!(zoom_shortcut("+", false, false, false, true), None);
        assert_eq!(zoom_shortcut("+", true, false, true, true), None);
        assert_eq!(zoom_shortcut("+", true, false, false, false), None);
        assert_eq!(zoom_shortcut("x", true, false, false, true), None);
        assert!(ZOOM_SHORTCUT_SCRIPT.contains("zoom_change"));
        assert!(ZOOM_SHORTCUT_SCRIPT.contains("keydown"));
        assert!(FILE_PATH_BRIDGE_SCRIPT.contains("getPathForFile"));
        assert!(FILE_PATH_BRIDGE_SCRIPT.contains("dsh-desktop-folder-drop"));
    }

    #[test]
    fn fullscreen_close_hides_after_exit_and_restores_on_show() {
        let mut state = FullscreenHideState::default();
        assert_eq!(state.on_close(true, false), ClosePlan::ExitFullscreenThenHide);
        // A second close while the exit is in flight only re-arms the hide.
        assert_eq!(state.on_close(true, false), ClosePlan::WaitForFullscreenExit);
        assert_eq!(state.on_leave_fullscreen(), LeaveFullscreenAction::Hide);
        assert_eq!(state.on_show(), ShowAction::EnterFullscreen);
        assert_eq!(state.on_show(), ShowAction::None);
    }

    #[test]
    fn fullscreen_show_during_exit_flips_hide_into_refullscreen() {
        let mut state = FullscreenHideState::default();
        state.on_close(true, false);
        // Reveal arrives before the leave-fullscreen event completes.
        assert_eq!(state.on_show(), ShowAction::None);
        assert_eq!(state.on_leave_fullscreen(), LeaveFullscreenAction::Refullscreen);
        assert_eq!(state, FullscreenHideState::default());
    }

    #[test]
    fn fullscreen_close_without_fullscreen_hides_and_quitting_closes() {
        let mut state = FullscreenHideState::default();
        assert_eq!(state.on_close(false, false), ClosePlan::Hide);
        assert_eq!(state.on_close(true, true), ClosePlan::AllowClose);
        assert_eq!(state.on_leave_fullscreen(), LeaveFullscreenAction::None);
    }
}
