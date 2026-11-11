//! Vertically center macOS traffic lights in the Desktop frame.
//!
//! Tauri/wry's `traffic_light_position.y` only grows the native titlebar
//! container (`button_height + y`) and never moves the buttons' origin.y.
//! Electron's `{ x: 16, y: 12 }` is the top inset that centers 12px lights
//! in the 36px frame. This module applies that geometry after the window exists.

use crate::window_ops::{macos_traffic_light_button_origin_y, MACOS_TRAFFIC_LIGHT_X};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSApplication, NSView, NSWindow, NSWindowButton};
use objc2_foundation::NSString;
use tauri::WebviewWindow;

pub fn apply_traffic_lights(window: &WebviewWindow, titlebar_height: u32) {
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    unsafe { inset_centered(ptr, MACOS_TRAFFIC_LIGHT_X, titlebar_height) };
}

/// Mirror the Electron `app.setBadgeCount` contract on the macOS Dock tile.
/// Must run on the main thread.
pub fn set_dock_badge(mtm: MainThreadMarker, count: u32) {
    let application = NSApplication::sharedApplication(mtm);
    let tile = application.dockTile();
    if count == 0 {
        tile.setBadgeLabel(None);
    } else {
        let label = NSString::from_str(&count.to_string());
        tile.setBadgeLabel(Some(&label));
    }
}

unsafe fn inset_centered(ns_window_ptr: *mut std::ffi::c_void, x: f64, titlebar_height: u32) {
    if ns_window_ptr.is_null() {
        return;
    }
    let ns_window = &*ns_window_ptr.cast::<NSWindow>();
    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
        return;
    };
    let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);
    let Some(title_bar_view) = close.superview() else {
        return;
    };
    let Some(title_bar_container) = title_bar_view.superview() else {
        return;
    };

    let titlebar = f64::from(titlebar_height);
    let close_rect = NSView::frame(&close);
    let mut container_rect = NSView::frame(&title_bar_container);
    container_rect.size.height = titlebar;
    container_rect.origin.y = ns_window.frame().size.height - titlebar;
    title_bar_container.setFrame(container_rect);

    let mut bar_rect = NSView::frame(&title_bar_view);
    bar_rect.size.height = titlebar;
    bar_rect.origin.y = 0.0;
    title_bar_view.setFrame(bar_rect);

    let space_between = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    let origin_y = macos_traffic_light_button_origin_y(titlebar_height, close_rect.size.height);
    let mut buttons = vec![close, miniaturize];
    if let Some(zoom) = zoom {
        buttons.push(zoom);
    }
    for (index, button) in buttons.into_iter().enumerate() {
        let mut rect = NSView::frame(&button);
        rect.origin.x = x + (index as f64 * space_between);
        rect.origin.y = origin_y;
        button.setFrameOrigin(rect.origin);
    }
}
