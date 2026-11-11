//! Desktop-owned native tray copy and menu structure, ported from the upstream
//! `tray-locale.ts` and `buildTrayTemplate` so the Tauri tray renders the same
//! product labels and group layout.

use crate::native_effects::{TrayItem, TraySubmenu};

/// Resolve DSH's zh/en locale from an OS language tag.
pub fn locale_from_tag(language_tag: &str) -> &'static str {
    let normalized = language_tag.trim();
    let lower = normalized.to_ascii_lowercase();
    if lower == "zh" || lower.starts_with("zh-") || lower.starts_with("zh_") {
        "zh"
    } else {
        "en"
    }
}

/// Resolve one native tray label in the active desktop locale.
pub fn tray_label(locale: &str, key: &str, value: &str) -> String {
    match (locale, key) {
        ("zh", "addProfile") => "新建 Profile…".into(),
        ("zh", "checkForUpdates") => "检查更新…".into(),
        ("zh", "checkingForUpdates") => "正在检查更新…".into(),
        ("zh", "downloadingUpdate") => format!("正在下载 DSH Desktop {value}…"),
        ("zh", "exportDiagnostics") => "导出诊断信息…".into(),
        ("zh", "openDesktop") => format!("打开 {value}"),
        ("zh", "openTerminal") => "打开 DSH 终端".into(),
        ("zh", "profile") => format!("Profile：{value}"),
        ("zh", "quit") => "退出".into(),
        ("zh", "switchToAdvanced") => "切换到增强模式".into(),
        ("zh", "switchToCompatibility") => "切换到兼容模式".into(),
        ("zh", "switchToExtended") => "切换到扩展窗口".into(),
        ("zh", "unavailableForDesktop") => format!("{value}（不可用于桌面端）"),
        ("zh", "updateAvailable") => format!("DSH Desktop {value} 可用"),
        (_, "addProfile") => "New Profile…".into(),
        (_, "checkForUpdates") => "Check for Updates…".into(),
        (_, "checkingForUpdates") => "Checking for Updates…".into(),
        (_, "downloadingUpdate") => format!("Downloading DSH Desktop {value}…"),
        (_, "exportDiagnostics") => "Export Diagnostics…".into(),
        (_, "openDesktop") => format!("Open {value}"),
        (_, "openTerminal") => "Open DSH Terminal".into(),
        (_, "profile") => format!("Profile: {value}"),
        (_, "quit") => "Quit".into(),
        (_, "switchToAdvanced") => "Switch to Enhanced Mode".into(),
        (_, "switchToCompatibility") => "Switch to Compatibility Mode".into(),
        (_, "switchToExtended") => "Switch to Extended Window".into(),
        (_, "unavailableForDesktop") => format!("{value} (Unavailable for Desktop)"),
        (_, "updateAvailable") => format!("DSH Desktop {value} Available"),
        _ => String::new(),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayPlanEntry {
    /// The leading "Open <product>" item that reveals the main window.
    Open { label: String },
    /// A contributed tray item in a group section.
    Item {
        id: String,
        label: String,
        enabled: bool,
        submenu: Vec<TraySubmenu>,
    },
    Separator,
    /// The trailing Quit item.
    Quit { label: String },
}

/// One tray menu entry resolved to its kind for assertions and wiring.
/// The accessors are the tested contract; production wiring pattern-matches.
#[allow(dead_code)]
impl TrayPlanEntry {
    pub fn item_id(&self) -> Option<&str> {
        match self {
            TrayPlanEntry::Item { id, .. } => Some(id),
            _ => None,
        }
    }

    pub fn is_separator(&self) -> bool {
        matches!(self, TrayPlanEntry::Separator)
    }

    pub fn enabled(&self) -> bool {
        match self {
            TrayPlanEntry::Item { enabled, .. } => *enabled,
            TrayPlanEntry::Open { .. } | TrayPlanEntry::Quit { .. } => true,
            TrayPlanEntry::Separator => false,
        }
    }
}

/// Compose the tray menu in the upstream order: Open, then `tools`, `profiles`,
/// and `status` group sections, then the mode-switch section (disabled on
/// Linux), then Quit. Empty groups contribute no separator.
pub fn tray_menu_plan(platform: &str, locale: &str, product_name: &str, items: &[TrayItem]) -> Vec<TrayPlanEntry> {
    let mut plan = vec![TrayPlanEntry::Open {
        label: tray_label(locale, "openDesktop", product_name),
    }];
    let mode_switches: Vec<&TrayItem> = items.iter().filter(|item| item.group == "mode").collect();
    for group in ["tools", "profiles", "status"] {
        append_group(&mut plan, items, group);
    }
    if !mode_switches.is_empty() {
        plan.push(TrayPlanEntry::Separator);
        for item in mode_switches {
            plan.push(TrayPlanEntry::Item {
                id: item.id.clone(),
                label: item.label.clone(),
                enabled: item.enabled && platform != "linux",
                submenu: item.submenu.clone(),
            });
        }
    }
    plan.push(TrayPlanEntry::Separator);
    plan.push(TrayPlanEntry::Quit {
        label: tray_label(locale, "quit", ""),
    });
    plan
}

fn append_group(plan: &mut Vec<TrayPlanEntry>, items: &[TrayItem], group: &str) {
    let mut group_items: Vec<&TrayItem> = items.iter().filter(|item| item.group == group).collect();
    if group_items.is_empty() {
        return;
    }
    group_items.sort_by(|left, right| left.order.cmp(&right.order).then(left.id.cmp(&right.id)));
    plan.push(TrayPlanEntry::Separator);
    for item in group_items {
        plan.push(TrayPlanEntry::Item {
            id: item.id.clone(),
            label: item.label.clone(),
            enabled: item.enabled,
            submenu: item.submenu.clone(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_effects::TraySubmenu;

    fn item(id: &str, group: &str, order: i64, label: &str) -> TrayItem {
        TrayItem {
            id: id.into(),
            group: group.into(),
            order,
            label: label.into(),
            enabled: true,
            submenu: Vec::new(),
        }
    }

    #[test]
    fn locale_resolves_zh_only_for_chinese_tags() {
        assert_eq!(locale_from_tag("zh"), "zh");
        assert_eq!(locale_from_tag("zh-CN"), "zh");
        assert_eq!(locale_from_tag("zh_Hans"), "zh");
        assert_eq!(locale_from_tag("en-US"), "en");
        assert_eq!(locale_from_tag("ja"), "en");
        assert_eq!(locale_from_tag(""), "en");
    }

    #[test]
    fn tray_labels_match_the_upstream_table() {
        assert_eq!(tray_label("en", "openDesktop", "DSH Desktop"), "Open DSH Desktop");
        assert_eq!(tray_label("zh", "openDesktop", "DSH Desktop"), "打开 DSH Desktop");
        assert_eq!(tray_label("en", "quit", ""), "Quit");
        assert_eq!(tray_label("zh", "quit", ""), "退出");
        assert_eq!(tray_label("en", "openTerminal", ""), "Open DSH Terminal");
        assert_eq!(tray_label("zh", "openTerminal", ""), "打开 DSH 终端");
        assert_eq!(tray_label("en", "switchToExtended", ""), "Switch to Extended Window");
        assert_eq!(tray_label("zh", "switchToExtended", ""), "切换到扩展窗口");
        assert_eq!(tray_label("en", "switchToAdvanced", ""), "Switch to Enhanced Mode");
        assert_eq!(tray_label("zh", "switchToAdvanced", ""), "切换到增强模式");
        assert_eq!(tray_label("en", "switchToCompatibility", ""), "Switch to Compatibility Mode");
        assert_eq!(tray_label("zh", "switchToCompatibility", ""), "切换到兼容模式");
        assert_eq!(tray_label("en", "profile", "desktop"), "Profile: desktop");
        assert_eq!(tray_label("zh", "profile", "desktop"), "Profile：desktop");
        assert_eq!(tray_label("en", "addProfile", ""), "New Profile…");
        assert_eq!(tray_label("zh", "addProfile", ""), "新建 Profile…");
        assert_eq!(
            tray_label("en", "unavailableForDesktop", "web"),
            "web (Unavailable for Desktop)"
        );
        assert_eq!(
            tray_label("zh", "unavailableForDesktop", "web"),
            "web（不可用于桌面端）"
        );
        assert_eq!(tray_label("en", "checkForUpdates", ""), "Check for Updates…");
        assert_eq!(tray_label("zh", "checkForUpdates", ""), "检查更新…");
        assert_eq!(tray_label("en", "checkingForUpdates", ""), "Checking for Updates…");
        assert_eq!(tray_label("zh", "checkingForUpdates", ""), "正在检查更新…");
        assert_eq!(
            tray_label("en", "downloadingUpdate", "1.2.0"),
            "Downloading DSH Desktop 1.2.0…"
        );
        assert_eq!(
            tray_label("zh", "downloadingUpdate", "1.2.0"),
            "正在下载 DSH Desktop 1.2.0…"
        );
        assert_eq!(tray_label("en", "updateAvailable", "1.2.0"), "DSH Desktop 1.2.0 Available");
        assert_eq!(tray_label("zh", "updateAvailable", "1.2.0"), "DSH Desktop 1.2.0 可用");
        assert_eq!(tray_label("en", "exportDiagnostics", ""), "Export Diagnostics…");
        assert_eq!(tray_label("zh", "exportDiagnostics", ""), "导出诊断信息…");
    }

    #[test]
    fn tray_menu_follows_group_structure_with_localized_open_and_quit() {
        let items = vec![
            item("t2", "tools", 20, "Export Diagnostics…"),
            item("t1", "tools", 10, "Open DSH Terminal"),
            item("p1", "profiles", 5, "Profile: desktop"),
            item("s1", "status", 7, "Check for Updates…"),
            item("m1", "mode", 1, "Switch to Extended Window"),
        ];
        let plan = tray_menu_plan("darwin", "en", "DSH Desktop", &items);
        let ids: Vec<Option<&str>> = plan.iter().map(|entry| entry.item_id()).collect();
        assert_eq!(
            ids,
            vec![
                None, // Open
                None, // separator
                Some("t1"),
                Some("t2"),
                None, // separator
                Some("p1"),
                None, // separator
                Some("s1"),
                None, // separator
                Some("m1"),
                None, // separator
                None, // Quit
            ]
        );
        match &plan[0] {
            TrayPlanEntry::Open { label } => assert_eq!(label, "Open DSH Desktop"),
            other => panic!("expected open item, got {other:?}"),
        }
        match plan.last() {
            Some(TrayPlanEntry::Quit { label }) => assert_eq!(label, "Quit"),
            other => panic!("expected quit item, got {other:?}"),
        }
    }

    #[test]
    fn empty_groups_contribute_no_separator_and_linux_disables_mode_switches() {
        let items = vec![
            item("t1", "tools", 10, "Open DSH Terminal"),
            item("m1", "mode", 1, "切换到扩展窗口"),
        ];
        let plan = tray_menu_plan("linux", "zh", "DSH Desktop", &items);
        let mode_entry = plan
            .iter()
            .find(|entry| entry.item_id() == Some("m1"))
            .expect("mode item present");
        assert!(!mode_entry.enabled());
        let tools_linux = tray_menu_plan("linux", "en", "DSH Desktop", &[item("t1", "tools", 10, "x")]);
        assert!(tools_linux.iter().any(|entry| entry.item_id() == Some("t1")));
        // No profiles/status sections: only the tools and Quit separators appear.
        let separator_count = tools_linux.iter().filter(|entry| entry.is_separator()).count();
        assert_eq!(separator_count, 2);
    }

    #[test]
    fn contributed_items_carry_submenus() {
        let mut profile = item("p1", "profiles", 5, "Profile: desktop");
        profile.submenu = vec![
            TraySubmenu {
                label: "desktop".into(),
                kind: "radio".into(),
                enabled: true,
                checked: true,
            },
            TraySubmenu {
                label: "新建 Profile…".into(),
                kind: "normal".into(),
                enabled: true,
                checked: false,
            },
        ];
        let plan = tray_menu_plan("darwin", "zh", "DSH Desktop", &[profile]);
        let entry = plan.iter().find(|e| e.item_id() == Some("p1")).expect("profile item");
        match entry {
            TrayPlanEntry::Item { submenu, .. } => {
                assert_eq!(submenu.len(), 2);
                assert_eq!(submenu[0].kind, "radio");
                assert!(submenu[0].checked);
                assert_eq!(submenu[1].label, "新建 Profile…");
            }
            other => panic!("expected item, got {other:?}"),
        }
    }
}
