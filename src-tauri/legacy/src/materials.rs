pub fn effective_material(platform: &str, mode: &str, macos: &str, windows: &str, build: Option<u32>) -> &'static str {
    let _ = mode;
    if platform == "linux" {
        return "off";
    }
    if platform == "darwin" {
        return if macos == "off" { "off" } else { "transparent" };
    }
    let n = build.unwrap_or(0);
    let system_backdrop = n >= 22_621;
    if windows == "acrylic" {
        return "off";
    }
    if windows == "mica" && system_backdrop {
        return "mica";
    }
    "off"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gates_windows_backdrops() {
        assert_eq!(
            effective_material("win32", "compatibility", "transparent", "mica", Some(22_631)),
            "mica"
        );
        assert_eq!(
            effective_material("win32", "extended", "transparent", "mica", Some(19_045)),
            "off"
        );
        assert_eq!(
            effective_material("win32", "extended", "transparent", "mica", Some(22_000)),
            "off"
        );
        assert_eq!(
            effective_material("win32", "extended", "transparent", "acrylic", Some(22_000)),
            "off"
        );
        assert_eq!(
            effective_material("win32", "extended", "transparent", "acrylic", Some(22_631)),
            "off"
        );
        assert_eq!(
            effective_material("linux", "compatibility", "transparent", "acrylic", None),
            "off"
        );
    }
}
