//! 只接受页面取色结果中的三个 RGB 字节；远程页面不获得任何壳命令权限。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorScheme {
    Light,
    Dark,
}

pub fn from_eval_result(result: &str) -> Option<ColorScheme> {
    if result.len() > 64 {
        return None;
    }
    let [r, g, b] = serde_json::from_str::<[u8; 3]>(result).ok()?;
    let luminance = u32::from(r) * 299 + u32::from(g) * 587 + u32::from(b) * 114;
    Some(if luminance >= 128_000 {
        ColorScheme::Light
    } else {
        ColorScheme::Dark
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_light_page_background() {
        assert_eq!(from_eval_result("[255,255,255]"), Some(ColorScheme::Light));
        assert_eq!(from_eval_result("[249,250,251]"), Some(ColorScheme::Light));
    }

    #[test]
    fn detects_dark_page_background() {
        assert_eq!(from_eval_result("[21,21,23]"), Some(ColorScheme::Dark));
        assert_eq!(from_eval_result("[0,0,0]"), Some(ColorScheme::Dark));
    }

    #[test]
    fn uses_all_color_channels_to_classify_brightness() {
        assert_eq!(from_eval_result("[255,0,0]"), Some(ColorScheme::Dark));
        assert_eq!(from_eval_result("[0,255,0]"), Some(ColorScheme::Light));
    }

    #[test]
    fn rejects_missing_malformed_or_unbounded_page_values() {
        for value in [
            "null",
            "undefined",
            "{}",
            "[]",
            "[1,2]",
            "[1,2,3,4]",
            "[-1,0,0]",
            "[256,0,0]",
            "[1.5,0,0]",
            "\"dark\"",
        ] {
            assert_eq!(from_eval_result(value), None, "{value}");
        }
        assert_eq!(
            from_eval_result(&format!("{}[1,2,3]", " ".repeat(1000))),
            None
        );
    }
}
