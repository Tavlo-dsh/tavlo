/** Upstream `DIALOG_MAX_HEIGHT`: bounded rendered height accepted from the local dialog UI. */
pub const DIALOG_MAX_CONTENT_HEIGHT: u32 = 440;
/** Upstream `DIALOG_MIN_CONTENT_HEIGHT`. */
pub const DIALOG_MIN_CONTENT_HEIGHT: u32 = 200;

pub fn parse_dialog_response(href: &str, button_count: usize) -> Option<u32> {
    let prefix = "dsh-desktop-dialog://response?";
    let query = href.strip_prefix(prefix)?;
    if query.contains('&') || query.contains('#') || query.contains('/') {
        return None;
    }
    let id = query.strip_prefix("id=")?;
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if id.len() > 1 && id.starts_with('0') {
        return None;
    }
    let response = id.parse::<u32>().ok()?;
    ((response as usize) < button_count).then_some(response)
}

/** Accept only a bounded rendered content height reported by the isolated local dialog UI. */
pub fn parse_dialog_layout(href: &str) -> Option<u32> {
    let prefix = "dsh-desktop-dialog://layout?";
    let query = href.strip_prefix(prefix)?;
    if query.contains('&') || query.contains('#') || query.contains('/') {
        return None;
    }
    let height = query.strip_prefix("height=")?;
    if height.is_empty() || !height.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if height.len() > 1 && height.starts_with('0') {
        return None;
    }
    let height = height.parse::<u32>().ok()?;
    (height > 0 && height <= DIALOG_MAX_CONTENT_HEIGHT).then_some(height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_bounded_id() {
        assert_eq!(
            parse_dialog_response("dsh-desktop-dialog://response?id=1", 2),
            Some(1)
        );
        assert_eq!(
            parse_dialog_response("dsh-desktop-dialog://response?id=2", 2),
            None
        );
        assert_eq!(
            parse_dialog_response("dsh-desktop-dialog://response?id=1&command=bad", 2),
            None
        );
        assert_eq!(parse_dialog_response("https://response/?id=1", 2), None);
    }

    #[test]
    fn accepts_bounded_rendered_height() {
        assert_eq!(
            parse_dialog_layout("dsh-desktop-dialog://layout?height=248"),
            Some(248)
        );
        assert_eq!(
            parse_dialog_layout("dsh-desktop-dialog://layout?height=440"),
            Some(440)
        );
        // Heights beyond the upstream bound are ignored, not clamped.
        assert_eq!(parse_dialog_layout("dsh-desktop-dialog://layout?height=441"), None);
        assert_eq!(parse_dialog_layout("dsh-desktop-dialog://layout?height=0"), None);
        assert_eq!(
            parse_dialog_layout("dsh-desktop-dialog://layout?height=248&extra=1"),
            None
        );
        assert_eq!(parse_dialog_layout("dsh-desktop-dialog://response?height=1"), None);
        assert_eq!(parse_dialog_layout("dsh-desktop-dialog://layout/extra?height=1"), None);
    }
}
