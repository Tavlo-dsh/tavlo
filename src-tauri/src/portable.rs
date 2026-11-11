//! 安装版 / 便携版的数据目录。
//!
//! 便携版：exe 同目录存在 `portable` 标记文件（便携 zip 自带）。此时 WebView2 数据与日志都写到
//! `<exe 目录>/data/`，不写 `%LOCALAPPDATA%`。DSH 自身数据（`~/.dsh`）仍归本机 dsh 管理，两种形态共享。

use std::path::{Path, PathBuf};

pub const PORTABLE_MARKER: &str = "portable";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataLayout {
    pub portable: bool,
    /// WebView2 用户数据目录；`None` 表示用 Tauri 默认位置。
    pub webview_dir: Option<PathBuf>,
    pub log_dir: PathBuf,
}

/// `exe_dir`：可执行文件所在目录；`default_log_dir`：安装版日志目录（Tauri app_log_dir）。
pub fn resolve_layout(exe_dir: Option<&Path>, default_log_dir: PathBuf) -> DataLayout {
    if let Some(dir) = exe_dir.filter(|dir| dir.join(PORTABLE_MARKER).is_file()) {
        let data = dir.join("data");
        return DataLayout {
            portable: true,
            webview_dir: Some(data.join("webview")),
            log_dir: data.join("logs"),
        };
    }
    DataLayout {
        portable: false,
        webview_dir: None,
        log_dir: default_log_dir,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_layout_uses_defaults() {
        let dir = std::env::temp_dir().join(format!("dsh-layout-installed-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let layout = resolve_layout(Some(&dir), PathBuf::from("C:/logs"));
        assert_eq!(
            layout,
            DataLayout { portable: false, webview_dir: None, log_dir: PathBuf::from("C:/logs") }
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_switches_to_portable_layout() {
        let dir = std::env::temp_dir().join(format!("dsh-layout-portable-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(PORTABLE_MARKER), "").unwrap();
        let layout = resolve_layout(Some(&dir), PathBuf::from("C:/logs"));
        assert!(layout.portable);
        assert_eq!(layout.webview_dir, Some(dir.join("data").join("webview")));
        assert_eq!(layout.log_dir, dir.join("data").join("logs"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
