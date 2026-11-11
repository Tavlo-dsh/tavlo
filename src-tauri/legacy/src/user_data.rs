use std::path::PathBuf;

pub fn desktop_user_data_dir() -> PathBuf {
    if let Ok(path) = std::env::var("DSH_DESKTOP_USER_DATA") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("DSH Desktop");
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\".into());
        return PathBuf::from(appdata).join("DSH Desktop");
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let home = std::env::var("XDG_CONFIG_HOME")
            .ok()
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config")
            });
        home.join("DSH Desktop")
    }
}
