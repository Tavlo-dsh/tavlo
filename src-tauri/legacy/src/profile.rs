use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileStateV2 {
    pub version: u8,
    pub active: String,
}

impl Default for ProfileStateV2 {
    fn default() -> Self {
        Self {
            version: 2,
            active: "desktop".into(),
        }
    }
}

pub fn parse_profile_state(text: &str) -> Result<ProfileStateV2, String> {
    let state: ProfileStateV2 =
        serde_json::from_str(text).map_err(|error| error.to_string())?;
    if state.version != 2 {
        return Err("selection state version must be 2".into());
    }
    assert_profile_name(&state.active)?;
    Ok(state)
}

pub fn load_profile_state(path: &Path) -> (ProfileStateV2, bool) {
    match fs::read_to_string(path) {
        Ok(text) => match parse_profile_state(&text) {
            Ok(state) => (state, false),
            Err(_) => (ProfileStateV2::default(), true),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (ProfileStateV2::default(), false)
        }
        Err(_) => (ProfileStateV2::default(), true),
    }
}

pub fn write_profile_state(path: &Path, active: &str) -> Result<(), String> {
    assert_profile_name(active)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let state = ProfileStateV2 {
        version: 2,
        active: active.to_string(),
    };
    fs::write(
        path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&state).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| error.to_string())
}

pub fn assert_profile_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name == "."
        || name == ".."
        || name == "node_modules"
        || name.len() > 255
    {
        return Err(format!("invalid desktop profile name {name:?}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parses_version_2() {
        let state = parse_profile_state("{\"version\":2,\"active\":\"web\"}\n").unwrap();
        assert_eq!(state.active, "web");
    }

    #[test]
    fn missing_file_is_desktop() {
        let (state, recovered) = load_profile_state(Path::new("/tmp/dsh-desktop-missing-state.json"));
        assert_eq!(state.active, "desktop");
        assert!(!recovered);
    }

    #[test]
    fn malformed_file_recovers() {
        let path = std::env::temp_dir().join("dsh-desktop-bad-state.json");
        let mut file = fs::File::create(&path).unwrap();
        file.write_all(b"{nope").unwrap();
        let (state, recovered) = load_profile_state(&path);
        assert_eq!(state.active, "desktop");
        assert!(recovered);
    }
}
