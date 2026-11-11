#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryAction {
    pub action: String,
    pub id: Option<String>,
    pub name: Option<String>,
}

pub fn parse_recovery_href(href: &str) -> Option<RecoveryAction> {
    let rest = href.strip_prefix("dsh-recovery://")?;
    let (action, query) = rest.split_once('?').unwrap_or((rest, ""));
    if action.is_empty() || action.contains('/') {
        return None;
    }
    let mut id = None;
    let mut name = None;
    if !query.is_empty() {
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=')?;
            match key {
                "id" => id = Some(value.to_string()),
                "name" => name = Some(value.to_string()),
                _ => return None,
            }
        }
    }
    Some(RecoveryAction {
        action: action.to_string(),
        id,
        name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_actions() {
        assert_eq!(
            parse_recovery_href("dsh-recovery://restart").unwrap().action,
            "restart"
        );
        let switched = parse_recovery_href("dsh-recovery://switch-profile?name=web").unwrap();
        assert_eq!(switched.name.as_deref(), Some("web"));
        assert!(parse_recovery_href("dsh-recovery://preview-disable?id=1&extra=1").is_none());
    }
}
