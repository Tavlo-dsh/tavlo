//! `dsh-profile-create://` href contract for the Profile creation window.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileCreateAction {
    Submit { name: String },
    Cancel,
}

const MAX_NAME_BYTES: usize = 1024;

/// Percent-decode one query value (UTF-8, `+` stays a literal plus).
fn decode_percent(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = bytes.get(index + 1..index + 3);
                match hex.and_then(|pair| {
                    std::str::from_utf8(pair)
                        .ok()
                        .and_then(|text| u8::from_str_radix(text, 16).ok())
                }) {
                    Some(byte) => {
                        out.push(byte);
                        index += 3;
                    }
                    None => {
                        out.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Parse the Profile creation window protocols: `submit?name=<name>` with a
/// single bounded query key, or `cancel`. Anything else is rejected.
pub fn parse_profile_create_href(href: &str) -> Option<ProfileCreateAction> {
    if href == "dsh-profile-create://cancel" {
        return Some(ProfileCreateAction::Cancel);
    }
    let rest = href.strip_prefix("dsh-profile-create://submit?name=")?;
    if rest.is_empty() || rest.contains('&') || rest.contains('#') || rest.contains('/') {
        return None;
    }
    if rest.len() > MAX_NAME_BYTES {
        return None;
    }
    Some(ProfileCreateAction::Submit {
        name: decode_percent(rest),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_submit_and_cancel() {
        assert_eq!(
            parse_profile_create_href("dsh-profile-create://submit?name=web"),
            Some(ProfileCreateAction::Submit { name: "web".into() })
        );
        assert_eq!(
            parse_profile_create_href("dsh-profile-create://cancel"),
            Some(ProfileCreateAction::Cancel)
        );
    }

    #[test]
    fn decodes_percent_encoded_names() {
        assert_eq!(
            parse_profile_create_href("dsh-profile-create://submit?name=%E5%B7%A5%E4%BD%9C"),
            Some(ProfileCreateAction::Submit { name: "工作".into() })
        );
        assert_eq!(
            parse_profile_create_href("dsh-profile-create://submit?name=a%20b"),
            Some(ProfileCreateAction::Submit { name: "a b".into() })
        );
    }

    #[test]
    fn rejects_empty_extra_keys_and_oversized_names() {
        assert_eq!(parse_profile_create_href("dsh-profile-create://submit?name="), None);
        assert_eq!(
            parse_profile_create_href("dsh-profile-create://submit?name=web&extra=1"),
            None
        );
        assert_eq!(
            parse_profile_create_href("dsh-profile-create://submit?name=web#frag"),
            None
        );
        let long = "a".repeat(1025);
        assert_eq!(
            parse_profile_create_href(&format!("dsh-profile-create://submit?name={long}")),
            None
        );
        let bounded = "a".repeat(1024);
        assert!(matches!(
            parse_profile_create_href(&format!("dsh-profile-create://submit?name={bounded}")),
            Some(ProfileCreateAction::Submit { .. })
        ));
        assert_eq!(parse_profile_create_href("https://example.com/submit?name=web"), None);
    }
}
