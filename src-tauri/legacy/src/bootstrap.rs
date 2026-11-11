use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NativeBootstrap {
    pub version: u8,
    #[serde(rename = "profileName")]
    pub profile_name: String,
    pub mode: String,
}

impl Default for NativeBootstrap {
    fn default() -> Self {
        Self {
            version: 1,
            profile_name: "desktop".into(),
            mode: "compatibility".into(),
        }
    }
}

pub fn parse_native_bootstrap(text: &str) -> Result<NativeBootstrap, String> {
    let state: NativeBootstrap = serde_json::from_str(text).map_err(|error| error.to_string())?;
    if state.version != 1 {
        return Err("native bootstrap version must be 1".into());
    }
    if !matches!(state.mode.as_str(), "compatibility" | "extended" | "advanced") {
        return Err("native bootstrap mode is invalid".into());
    }
    Ok(state)
}

pub fn load_native_bootstrap(user_data: &Path) -> NativeBootstrap {
    let path = user_data.join("native-bootstrap.json");
    match fs::read_to_string(path) {
        Ok(text) => parse_native_bootstrap(&text).unwrap_or_default(),
        Err(_) => NativeBootstrap::default(),
    }
}

pub fn write_native_bootstrap(user_data: &Path, profile_name: &str, mode: &str) -> std::io::Result<()> {
    fs::create_dir_all(user_data)?;
    let state = NativeBootstrap {
        version: 1,
        profile_name: profile_name.to_string(),
        mode: mode.to_string(),
    };
    fs::write(
        user_data.join("native-bootstrap.json"),
        format!("{}\n", serde_json::to_string_pretty(&state).expect("bootstrap json")),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_two_fields() {
        let state = parse_native_bootstrap(
            "{\"version\":1,\"profileName\":\"web\",\"mode\":\"extended\"}",
        )
        .unwrap();
        assert_eq!(state.profile_name, "web");
        assert_eq!(state.mode, "extended");
    }
}
