//! Tavlo 原生关闭偏好。标记文件存在即启用驻留；删除标记即恢复默认。

use std::io;
use std::path::Path;

const CLOSE_TO_TRAY_MARKER: &str = "close-to-tray.enabled";

pub fn close_to_tray_enabled(settings_dir: &Path) -> io::Result<bool> {
    let marker = settings_dir.join(CLOSE_TO_TRAY_MARKER);
    match std::fs::symlink_metadata(marker) {
        Ok(metadata) if metadata.is_file() => Ok(true),
        Ok(_) => Err(io::Error::new(io::ErrorKind::InvalidData, "关闭偏好标记不是普通文件")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

pub fn set_close_to_tray(settings_dir: &Path, enabled: bool) -> io::Result<()> {
    let marker = settings_dir.join(CLOSE_TO_TRAY_MARKER);
    if enabled {
        std::fs::create_dir_all(settings_dir)?;
        std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(marker)?;
        Ok(())
    } else {
        match std::fs::remove_file(marker) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_settings_dir() -> PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("tavlo-settings-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn close_to_tray_defaults_off_persists_and_resets() {
        let dir = temporary_settings_dir();
        assert!(!close_to_tray_enabled(&dir).unwrap());

        set_close_to_tray(&dir, true).unwrap();
        assert!(close_to_tray_enabled(&dir).unwrap());

        set_close_to_tray(&dir, false).unwrap();
        assert!(!close_to_tray_enabled(&dir).unwrap());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn reset_is_repeatable_and_preserves_other_settings() {
        let dir = temporary_settings_dir();
        set_close_to_tray(&dir, false).unwrap();
        set_close_to_tray(&dir, true).unwrap();
        std::fs::write(dir.join("another-setting"), "keep").unwrap();

        set_close_to_tray(&dir, false).unwrap();
        set_close_to_tray(&dir, false).unwrap();
        assert!(!close_to_tray_enabled(&dir).unwrap());
        assert_eq!(std::fs::read_to_string(dir.join("another-setting")).unwrap(), "keep");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_setting_reports_an_error_instead_of_silently_resetting() {
        let dir = temporary_settings_dir();
        std::fs::create_dir_all(dir.join(CLOSE_TO_TRAY_MARKER)).unwrap();
        assert!(close_to_tray_enabled(&dir).is_err());
        assert!(set_close_to_tray(&dir, true).is_err());
        assert!(set_close_to_tray(&dir, false).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
