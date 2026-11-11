use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Default)]
pub struct TrayIcons {
    #[serde(rename = "templatePath", default)]
    pub template_path: String,
    #[serde(rename = "bluePath", default)]
    pub blue_path: String,
}

/// Generation-scoped capability distinguishing the desktop renderer from ordinary browsers.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct RendererAccessHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ShellPayload {
    pub mode: String,
    pub material: String,
    pub width: u32,
    pub height: u32,
    #[serde(rename = "minWidth")]
    pub min_width: u32,
    #[serde(rename = "minHeight")]
    pub min_height: u32,
    pub url: String,
    /// Ephemeral renderer capability the shell must attach to every carrier request.
    #[serde(rename = "rendererAccessHeader", default)]
    pub renderer_access_header: Option<RendererAccessHeader>,
    #[serde(rename = "productName")]
    pub product_name: String,
    #[serde(rename = "windowTitle")]
    pub window_title: String,
    #[serde(rename = "themeSource")]
    pub theme_source: String,
    #[serde(rename = "iconPath", default)]
    pub icon_path: String,
    #[serde(rename = "trayIcons", default)]
    pub tray_icons: TrayIcons,
    #[serde(default)]
    pub locale: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowChrome {
    pub titlebar_height: u32,
    pub macos_traffic_light_top: u32,
}

pub fn chrome_for_mode(mode: &str) -> WindowChrome {
    if mode == "advanced" {
        WindowChrome {
            titlebar_height: 32,
            macos_traffic_light_top: 16,
        }
    } else {
        WindowChrome {
            titlebar_height: 36,
            macos_traffic_light_top: 12,
        }
    }
}

pub fn linux_forces_compatibility(platform: &str, mode: &str) -> bool {
    platform == "linux" && mode != "compatibility"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_uses_36px_frame() {
        assert_eq!(chrome_for_mode("compatibility").titlebar_height, 36);
        assert_eq!(chrome_for_mode("extended").titlebar_height, 36);
        assert_eq!(chrome_for_mode("advanced").titlebar_height, 32);
    }

    #[test]
    fn linux_rejects_advanced_modes() {
        assert!(linux_forces_compatibility("linux", "advanced"));
        assert!(!linux_forces_compatibility("darwin", "advanced"));
    }

    #[test]
    fn payload_carries_generation_renderer_header() {
        let value = serde_json::json!({
            "mode": "compatibility",
            "material": "off",
            "width": 1280,
            "height": 840,
            "minWidth": 900,
            "minHeight": 640,
            "url": "http://127.0.0.1:43120/?dsh-desktop-mode=compatibility",
            "rendererAccessHeader": {
                "name": "x-dsh-desktop-renderer",
                "value": "A".repeat(43),
            },
            "productName": "DSH Desktop",
            "windowTitle": "DeepSeek Harness Desktop",
            "themeSource": "system",
        });
        let payload: ShellPayload = serde_json::from_value(value).expect("payload");
        let header = payload.renderer_access_header.expect("renderer header");
        assert_eq!(header.name, "x-dsh-desktop-renderer");
        assert_eq!(header.value.len(), 43);
    }

    #[test]
    fn payload_tolerates_missing_renderer_header() {
        let value = serde_json::json!({
            "mode": "compatibility",
            "material": "off",
            "width": 1280,
            "height": 840,
            "minWidth": 900,
            "minHeight": 640,
            "url": "http://127.0.0.1:43120/",
            "productName": "DSH Desktop",
            "windowTitle": "DeepSeek Harness Desktop",
            "themeSource": "system",
        });
        let payload: ShellPayload = serde_json::from_value(value).expect("payload");
        assert!(payload.renderer_access_header.is_none());
    }
}
