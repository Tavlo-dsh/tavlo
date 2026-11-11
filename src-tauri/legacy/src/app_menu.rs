//! macOS application menu plan, ported from the upstream `native-menu.ts`
//! so the darwin shell installs the same five menus and system roles.

/// One resolved entry inside a submenu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuEntry {
    /// A macOS system role handled natively (undo, copy, quit, ...).
    Role { role: &'static str, label: String },
    /// A contributed tray item surfaced in the app submenu.
    Item { id: String, label: String },
    Separator,
}

/// One top-level menu with its localized title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuSection {
    pub title: String,
    pub entries: Vec<MenuEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppMenuPlan {
    pub sections: Vec<MenuSection>,
}

/// Pick the first supported language from the OS preference order.
pub fn native_menu_locale(preferred_languages: &[&str]) -> &'static str {
    for language in preferred_languages {
        let normalized = language.to_lowercase().replace('_', "-");
        if normalized == "zh"
            || normalized == "zh-cn"
            || normalized == "zh-sg"
            || normalized == "zh-hans"
            || normalized.starts_with("zh-hans-")
        {
            return "zh-CN";
        }
        if normalized == "en" || normalized.starts_with("en-") {
            return "en";
        }
    }
    "en"
}

/// Resolve one localized label shared by the menu tables.
pub fn menu_label(locale: &str, key: &str, app_name: &str) -> String {
    match (locale, key) {
        ("zh-CN", "about") => format!("关于 {app_name}"),
        ("zh-CN", "closeWindow") => "关闭窗口".into(),
        ("zh-CN", "copy") => "拷贝".into(),
        ("zh-CN", "cut") => "剪切".into(),
        ("zh-CN", "delete") => "删除".into(),
        ("zh-CN", "edit") => "编辑".into(),
        ("zh-CN", "file") => "文件".into(),
        ("zh-CN", "forceReload") => "强制重新载入".into(),
        ("zh-CN", "hide") => format!("隐藏 {app_name}"),
        ("zh-CN", "hideOthers") => "隐藏其他".into(),
        ("zh-CN", "minimize") => "最小化".into(),
        ("zh-CN", "paste") => "粘贴".into(),
        ("zh-CN", "pasteAndMatchStyle") => "粘贴并匹配样式".into(),
        ("zh-CN", "quit") => format!("退出 {app_name}"),
        ("zh-CN", "redo") => "重做".into(),
        ("zh-CN", "reload") => "重新载入".into(),
        ("zh-CN", "resetZoom") => "实际大小".into(),
        ("zh-CN", "selectAll") => "全选".into(),
        ("zh-CN", "services") => "服务".into(),
        ("zh-CN", "showAll") => "全部显示".into(),
        ("zh-CN", "toggleDevTools") => "开发者工具".into(),
        ("zh-CN", "toggleFullScreen") => "进入全屏幕".into(),
        ("zh-CN", "undo") => "撤销".into(),
        ("zh-CN", "view") => "显示".into(),
        ("zh-CN", "window") => "窗口".into(),
        ("zh-CN", "windowFront") => "前置全部窗口".into(),
        ("zh-CN", "windowZoom") => "缩放".into(),
        ("zh-CN", "zoomIn") => "放大".into(),
        ("zh-CN", "zoomOut") => "缩小".into(),
        (_, "about") => format!("About {app_name}"),
        (_, "closeWindow") => "Close Window".into(),
        (_, "copy") => "Copy".into(),
        (_, "cut") => "Cut".into(),
        (_, "delete") => "Delete".into(),
        (_, "edit") => "Edit".into(),
        (_, "file") => "File".into(),
        (_, "forceReload") => "Force Reload".into(),
        (_, "hide") => format!("Hide {app_name}"),
        (_, "hideOthers") => "Hide Others".into(),
        (_, "minimize") => "Minimize".into(),
        (_, "paste") => "Paste".into(),
        (_, "pasteAndMatchStyle") => "Paste and Match Style".into(),
        (_, "quit") => format!("Quit {app_name}"),
        (_, "redo") => "Redo".into(),
        (_, "reload") => "Reload".into(),
        (_, "resetZoom") => "Actual Size".into(),
        (_, "selectAll") => "Select All".into(),
        (_, "services") => "Services".into(),
        (_, "showAll") => "Show All".into(),
        (_, "toggleDevTools") => "Developer Tools".into(),
        (_, "toggleFullScreen") => "Enter Full Screen".into(),
        (_, "undo") => "Undo".into(),
        (_, "view") => "View".into(),
        (_, "window") => "Window".into(),
        (_, "windowFront") => "Bring All to Front".into(),
        (_, "windowZoom") => "Zoom".into(),
        (_, "zoomIn") => "Zoom In".into(),
        (_, "zoomOut") => "Zoom Out".into(),
        _ => String::new(),
    }
}

/// Build the complete darwin menu plan. `additions` are the tray tools and
/// profiles contributions injected into the app submenu; win32/linux callers
/// get an empty plan because the upstream product installs no app menu there.
pub fn app_menu_plan(
    platform: &str,
    locale: &str,
    app_name: &str,
    additions: &[(&str, &str)],
) -> AppMenuPlan {
    if platform != "darwin" {
        return AppMenuPlan { sections: Vec::new() };
    }
    let mut app_entries = vec![MenuEntry::Role {
        role: "about",
        label: menu_label(locale, "about", app_name),
    }];
    if additions.is_empty() {
        app_entries.push(MenuEntry::Separator);
    } else {
        app_entries.push(MenuEntry::Separator);
        for (id, label) in additions {
            app_entries.push(MenuEntry::Item {
                id: (*id).into(),
                label: (*label).into(),
            });
        }
        app_entries.push(MenuEntry::Separator);
    }
    app_entries.push(MenuEntry::Role {
        role: "services",
        label: menu_label(locale, "services", app_name),
    });
    app_entries.push(MenuEntry::Separator);
    app_entries.push(MenuEntry::Role {
        role: "hide",
        label: menu_label(locale, "hide", app_name),
    });
    app_entries.push(MenuEntry::Role {
        role: "hideOthers",
        label: menu_label(locale, "hideOthers", app_name),
    });
    app_entries.push(MenuEntry::Role {
        role: "unhide",
        label: menu_label(locale, "showAll", app_name),
    });
    app_entries.push(MenuEntry::Separator);
    app_entries.push(MenuEntry::Role {
        role: "quit",
        label: menu_label(locale, "quit", app_name),
    });

    AppMenuPlan {
        sections: vec![
            MenuSection {
                title: app_name.to_string(),
                entries: app_entries,
            },
            MenuSection {
                title: menu_label(locale, "file", app_name),
                entries: vec![MenuEntry::Role {
                    role: "close",
                    label: menu_label(locale, "closeWindow", app_name),
                }],
            },
            MenuSection {
                title: menu_label(locale, "edit", app_name),
                entries: vec![
                    MenuEntry::Role { role: "undo", label: menu_label(locale, "undo", app_name) },
                    MenuEntry::Role { role: "redo", label: menu_label(locale, "redo", app_name) },
                    MenuEntry::Separator,
                    MenuEntry::Role { role: "cut", label: menu_label(locale, "cut", app_name) },
                    MenuEntry::Role { role: "copy", label: menu_label(locale, "copy", app_name) },
                    MenuEntry::Role { role: "paste", label: menu_label(locale, "paste", app_name) },
                    MenuEntry::Role {
                        role: "pasteAndMatchStyle",
                        label: menu_label(locale, "pasteAndMatchStyle", app_name),
                    },
                    MenuEntry::Role { role: "delete", label: menu_label(locale, "delete", app_name) },
                    MenuEntry::Role {
                        role: "selectAll",
                        label: menu_label(locale, "selectAll", app_name),
                    },
                ],
            },
            MenuSection {
                title: menu_label(locale, "view", app_name),
                entries: vec![
                    MenuEntry::Role { role: "reload", label: menu_label(locale, "reload", app_name) },
                    MenuEntry::Role {
                        role: "forceReload",
                        label: menu_label(locale, "forceReload", app_name),
                    },
                    MenuEntry::Role {
                        role: "toggleDevTools",
                        label: menu_label(locale, "toggleDevTools", app_name),
                    },
                    MenuEntry::Separator,
                    MenuEntry::Role {
                        role: "resetZoom",
                        label: menu_label(locale, "resetZoom", app_name),
                    },
                    MenuEntry::Role { role: "zoomIn", label: menu_label(locale, "zoomIn", app_name) },
                    MenuEntry::Role { role: "zoomOut", label: menu_label(locale, "zoomOut", app_name) },
                    MenuEntry::Separator,
                    MenuEntry::Role {
                        role: "togglefullscreen",
                        label: menu_label(locale, "toggleFullScreen", app_name),
                    },
                ],
            },
            MenuSection {
                title: menu_label(locale, "window", app_name),
                entries: vec![
                    MenuEntry::Role { role: "minimize", label: menu_label(locale, "minimize", app_name) },
                    MenuEntry::Role { role: "zoom", label: menu_label(locale, "windowZoom", app_name) },
                    MenuEntry::Separator,
                    MenuEntry::Role { role: "front", label: menu_label(locale, "windowFront", app_name) },
                ],
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_picks_supported_languages() {
        assert_eq!(native_menu_locale(&["zh-CN", "en"]), "zh-CN");
        assert_eq!(native_menu_locale(&["zh-Hans-CN"]), "zh-CN");
        assert_eq!(native_menu_locale(&["zh_sg"]), "zh-CN");
        assert_eq!(native_menu_locale(&["en-US"]), "en");
        assert_eq!(native_menu_locale(&["ja", "en"]), "en");
        assert_eq!(native_menu_locale(&[]), "en");
    }

    #[test]
    fn darwin_plan_has_five_menus_with_roles() {
        let plan = app_menu_plan("darwin", "en", "DSH Desktop", &[]);
        let titles: Vec<&str> = plan.sections.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["DSH Desktop", "File", "Edit", "View", "Window"]);
        let app = &plan.sections[0];
        let roles: Vec<&str> = app
            .entries
            .iter()
            .filter_map(|entry| match entry {
                MenuEntry::Role { role, .. } => Some(*role),
                _ => None,
            })
            .collect();
        assert_eq!(
            roles,
            vec!["about", "services", "hide", "hideOthers", "unhide", "quit"]
        );
        let separator_count = app
            .entries
            .iter()
            .filter(|entry| matches!(entry, MenuEntry::Separator))
            .count();
        assert_eq!(separator_count, 3);
        let edit_roles: Vec<&str> = plan.sections[2]
            .entries
            .iter()
            .filter_map(|entry| match entry {
                MenuEntry::Role { role, .. } => Some(*role),
                _ => None,
            })
            .collect();
        assert_eq!(
            edit_roles,
            vec![
                "undo", "redo", "cut", "copy", "paste", "pasteAndMatchStyle", "delete", "selectAll"
            ]
        );
        let view_roles: Vec<&str> = plan.sections[3]
            .entries
            .iter()
            .filter_map(|entry| match entry {
                MenuEntry::Role { role, .. } => Some(*role),
                _ => None,
            })
            .collect();
        assert_eq!(
            view_roles,
            vec!["reload", "forceReload", "toggleDevTools", "resetZoom", "zoomIn", "zoomOut", "togglefullscreen"]
        );
        let window_roles: Vec<&str> = plan.sections[4]
            .entries
            .iter()
            .filter_map(|entry| match entry {
                MenuEntry::Role { role, .. } => Some(*role),
                _ => None,
            })
            .collect();
        assert_eq!(window_roles, vec!["minimize", "zoom", "front"]);
    }

    #[test]
    fn injected_additions_expand_the_app_submenu_with_four_separators() {
        let plan = app_menu_plan(
            "darwin",
            "en",
            "DSH Desktop",
            &[("tray-1", "Open DSH Terminal"), ("tray-2", "Profile: desktop")],
        );
        let app = &plan.sections[0];
        let separator_count = app
            .entries
            .iter()
            .filter(|entry| matches!(entry, MenuEntry::Separator))
            .count();
        assert_eq!(separator_count, 4);
        let items: Vec<&str> = app
            .entries
            .iter()
            .filter_map(|entry| match entry {
                MenuEntry::Item { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(items, vec!["tray-1", "tray-2"]);
    }

    #[test]
    fn chinese_plan_localizes_titles_and_labels() {
        let plan = app_menu_plan("darwin", "zh-CN", "DSH Desktop", &[]);
        let titles: Vec<&str> = plan.sections.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["DSH Desktop", "文件", "编辑", "显示", "窗口"]);
        assert!(matches!(
            plan.sections[0].entries.first(),
            Some(MenuEntry::Role { role: "about", label }) if label == "关于 DSH Desktop"
        ));
        assert!(plan
            .sections[0]
            .entries
            .iter()
            .any(|entry| matches!(entry, MenuEntry::Role { role: "quit", label } if label == "退出 DSH Desktop")));
        assert!(matches!(
            plan.sections[1].entries.first(),
            Some(MenuEntry::Role { role: "close", label }) if label == "关闭窗口"
        ));
    }

    #[test]
    fn other_platforms_install_no_app_menu() {
        assert!(app_menu_plan("win32", "en", "DSH Desktop", &[]).sections.is_empty());
        assert!(app_menu_plan("linux", "zh-CN", "DSH Desktop", &[]).sections.is_empty());
    }
}
