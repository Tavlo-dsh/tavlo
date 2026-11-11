use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};

#[allow(dead_code)]
pub fn host_entry_path() -> PathBuf {
    host_entry_path_from(None)
}

pub fn host_entry_path_from(resource_dir: Option<&Path>) -> PathBuf {
    if let Ok(path) = std::env::var("DSH_HOST_ENTRY") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    let mut candidates = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("host/dist/main.js"));
        candidates.push(dir.join("dist/main.js"));
        candidates.push(dir.join("main.js"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../host/dist/main.js"));
    candidates
        .into_iter()
        .find(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../host/dist/main.js"))
}

const PATH_SEPARATOR: char = if cfg!(windows) { ';' } else { ':' };
const UNIX_PATH_EXTRAS: [&str; 3] = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
const WELL_KNOWN_BUN: [&str; 3] = ["/opt/homebrew/bin/bun", "/usr/local/bin/bun", "/usr/bin/bun"];
const WELL_KNOWN_NODE: [&str; 3] = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
const BUN_CLI_FLAGS: [&str; 3] = ["--bun", "--no-env-file", "--no-install"];

#[derive(Clone, Debug, Default)]
pub struct JsRuntimeLookup {
    pub override_binary: Option<PathBuf>,
    pub bundled_dirs: Vec<PathBuf>,
    pub path_dirs: Vec<PathBuf>,
    pub home: Option<PathBuf>,
    pub extra_abs: Vec<PathBuf>,
}

impl JsRuntimeLookup {
    pub fn from_env() -> Self {
        let override_binary = std::env::var("DSH_NODE_BINARY")
            .ok()
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);
        let mut path_dirs = Vec::new();
        for extra in UNIX_PATH_EXTRAS {
            path_dirs.push(PathBuf::from(extra));
        }
        if let Ok(path) = std::env::var("PATH") {
            for item in path.split(PATH_SEPARATOR) {
                if item.is_empty() {
                    continue;
                }
                if !path_dirs.iter().any(|dir| dir == Path::new(item)) {
                    path_dirs.push(PathBuf::from(item));
                }
            }
        }
        let mut extra_abs = Vec::new();
        extra_abs.extend(WELL_KNOWN_BUN.iter().map(PathBuf::from));
        extra_abs.extend(WELL_KNOWN_NODE.iter().map(PathBuf::from));
        Self {
            override_binary,
            bundled_dirs: default_bundled_dirs(None),
            path_dirs,
            home: std::env::var_os("HOME").map(PathBuf::from),
            extra_abs,
        }
    }

    pub fn with_resources(mut self, resource_dir: Option<&Path>) -> Self {
        self.bundled_dirs = default_bundled_dirs(resource_dir);
        self
    }
}

pub fn default_bundled_dirs(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(dir) = resource_dir {
        dirs.push(dir.join("runtimes"));
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/runtimes"));
    dirs
}

fn executable_name(stem: &str) -> String {
    if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem.to_string()
    }
}

pub fn is_bun_executable(runtime: &Path) -> bool {
    runtime
        .file_stem()
        .and_then(|stem| stem.to_str())
        .is_some_and(|stem| stem.eq_ignore_ascii_case("bun"))
}

pub fn host_process_args(runtime: &Path, entry: &Path) -> Vec<String> {
    let mut args = Vec::new();
    if is_bun_executable(runtime) {
        args.extend(BUN_CLI_FLAGS.iter().map(|flag| (*flag).to_string()));
    }
    args.push(entry.display().to_string());
    args
}

fn newest_existing(mut candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates.sort();
    candidates.into_iter().rev().find(|path| path.is_file())
}

fn find_named_in_dirs(lookup: &JsRuntimeLookup, stem: &str) -> Option<PathBuf> {
    let name = executable_name(stem);
    for dir in &lookup.path_dirs {
        let candidate = dir.join(&name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    lookup
        .extra_abs
        .iter()
        .find(|path| path.file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case(stem)) && path.is_file())
        .cloned()
}

fn find_bun(lookup: &JsRuntimeLookup) -> Option<PathBuf> {
    if let Some(path) = find_named(&lookup.bundled_dirs, "bun") {
        return Some(path);
    }
    if let Some(home) = &lookup.home {
        let candidate = home.join(".bun/bin").join(executable_name("bun"));
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    find_named_in_dirs(lookup, "bun")
}

fn find_named(dirs: &[PathBuf], stem: &str) -> Option<PathBuf> {
    let name = executable_name(stem);
    dirs.iter()
        .map(|dir| dir.join(&name))
        .find(|path| path.is_file())
}

fn find_node(lookup: &JsRuntimeLookup) -> Option<PathBuf> {
    if let Some(path) = find_named(&lookup.bundled_dirs, "node") {
        return Some(path);
    }
    if let Some(home) = &lookup.home {
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let versions: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path().join("bin").join(executable_name("node")))
                .collect();
            if let Some(node) = newest_existing(versions) {
                return Some(node);
            }
        }
        if let Ok(entries) = std::fs::read_dir(home.join("Library/Application Support/fnm/node-versions")) {
            let versions: Vec<PathBuf> = entries
                .flatten()
                .map(|entry| entry.path().join("installation/bin").join(executable_name("node")))
                .collect();
            if let Some(node) = newest_existing(versions) {
                return Some(node);
            }
        }
    }
    find_named_in_dirs(lookup, "node")
}

#[allow(dead_code)]
pub fn resolve_js_runtime(lookup: &JsRuntimeLookup) -> PathBuf {
    resolve_js_runtime_with_bun_filter(lookup, |_| true)
}

pub fn resolve_js_runtime_with_bun_filter(
    lookup: &JsRuntimeLookup,
    bun_usable: impl Fn(&Path) -> bool,
) -> PathBuf {
    if let Some(path) = &lookup.override_binary {
        return path.clone();
    }
    if let Some(bun) = find_bun(lookup) {
        if bun_usable(&bun) {
            return bun;
        }
    }
    find_node(lookup).unwrap_or_else(|| PathBuf::from("node"))
}

/// Official Host needs `findPackageJSON` and `registerHooks` from `node:module`.
/// Current Bun still lacks both; shims exist, but Cordis `loader.internal` boot
/// still fails. Skip Bun until the runtime exports those APIs. `DSH_NODE_BINARY` bypasses this.
pub fn bun_exports_official_host_apis(bun: &Path) -> bool {
    Command::new(bun)
        .args([
            "--bun",
            "--no-env-file",
            "--no-install",
            "-e",
            "import * as m from 'node:module'; process.exit(typeof m.findPackageJSON === 'function' && typeof m.registerHooks === 'function' ? 0 : 2)",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn js_runtime_binary() -> PathBuf {
    js_runtime_binary_from(None)
}

pub fn js_runtime_binary_from(resource_dir: Option<&Path>) -> PathBuf {
    let lookup = JsRuntimeLookup::from_env().with_resources(resource_dir);
    let resolved = resolve_js_runtime_with_bun_filter(&lookup, bun_exports_official_host_apis);
    if lookup.override_binary.is_none() {
        if let Some(bun) = find_bun(&lookup) {
            if bun != resolved {
                eprintln!(
                    "dsh-desktop: {} lacks node:module findPackageJSON/registerHooks; Host using {}",
                    bun.display(),
                    resolved.display()
                );
            }
        }
    }
    resolved
}

#[allow(dead_code)]
pub fn node_binary() -> PathBuf {
    js_runtime_binary()
}

fn ensure_unix_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Ok(meta) = std::fs::metadata(path) else {
            return;
        };
        let mode = meta.permissions().mode();
        if mode & 0o111 == 0 {
            let mut perms = meta.permissions();
            perms.set_mode(mode | 0o755);
            let _ = std::fs::set_permissions(path, perms);
        }
    }
}

fn path_with_runtime(runtime: &Path, existing: String) -> String {
    let mut prefixes = Vec::new();
    if let Some(dir) = runtime.parent() {
        prefixes.push(dir.to_string_lossy().into_owned());
    }
    prefixes.extend(UNIX_PATH_EXTRAS.iter().map(|dir| (*dir).to_string()));
    let mut path = existing;
    for prefix in prefixes {
        if prefix.is_empty() {
            continue;
        }
        if !path.split(PATH_SEPARATOR).any(|item| item == prefix) {
            path = format!("{prefix}{PATH_SEPARATOR}{path}");
        }
    }
    path
}

pub fn dsh_plugin_desktop_root(resource_dir: Option<&Path>) -> PathBuf {
    if let Ok(path) = std::env::var("DSH_PLUGIN_DESKTOP_ROOT") {
        if !path.is_empty() {
            return PathBuf::from(path);
        }
    }
    let mut candidates = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("dsh-plugin-desktop"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.anywhere-labs-dsh-desktop/dsh-plugin-desktop"));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../anywhere-labs-dsh-desktop/dsh-plugin-desktop"));
    candidates
        .into_iter()
        .find(|path| path.join("lib/tauri-host.js").exists())
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.anywhere-labs-dsh-desktop/dsh-plugin-desktop")
        })
}

pub fn spawn_host(
    entry: &Path,
    user_data: &Path,
    recovery: bool,
    resource_dir: Option<&Path>,
) -> std::io::Result<Child> {
    spawn_host_with(
        entry,
        user_data,
        recovery,
        resource_dir,
        &js_runtime_binary_from(resource_dir),
    )
}

fn spawn_host_with(
    entry: &Path,
    user_data: &Path,
    recovery: bool,
    resource_dir: Option<&Path>,
    runtime: &Path,
) -> std::io::Result<Child> {
    std::fs::create_dir_all(user_data)?;
    ensure_unix_executable(runtime);
    let mut command = Command::new(runtime);
    let path = path_with_runtime(runtime, std::env::var("PATH").unwrap_or_default());
    let plugin_root = dsh_plugin_desktop_root(resource_dir);
    command
        .args(host_process_args(runtime, entry))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .env("DSH_DESKTOP_USER_DATA", user_data)
        .env("PATH", path)
        .env("DSH_NODE_BINARY", runtime)
        .env("DSH_DEV_TOOLS", if cfg!(dsh_devtools) { "1" } else { "0" })
        .env("DSH_PLUGIN_DESKTOP_ROOT", &plugin_root)
        .env("DSH_OFFICIAL_HOST", "1")
        .current_dir(user_data);
    if recovery {
        command.arg("--recovery");
    }
    command.spawn()
}

pub fn take_stdin(child: &mut Child) -> Option<ChildStdin> {
    child.stdin.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_dir(label: &str) -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let dir = std::env::temp_dir().join(format!(
            "dsh-{label}-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch_executable(path: &Path) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(path, []).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    #[test]
    fn default_entry_points_at_compiled_host() {
        let path = host_entry_path();
        assert!(path.ends_with("host/dist/main.js") || path.ends_with("host\\dist\\main.js"));
    }

    #[test]
    fn node_binary_is_resolvable() {
        let path = node_binary();
        assert!(!path.as_os_str().is_empty());
        assert_eq!(path, js_runtime_binary());
    }

    #[test]
    fn js_runtime_override_wins_over_bun() {
        let lookup = JsRuntimeLookup {
            override_binary: Some(PathBuf::from("/explicit/node")),
            bundled_dirs: vec![],
            path_dirs: vec![PathBuf::from("/unused")],
            home: None,
            extra_abs: vec![],
        };
        assert_eq!(resolve_js_runtime(&lookup), PathBuf::from("/explicit/node"));
    }

    #[test]
    fn js_runtime_prefers_bun_over_node_on_path() {
        let root = unique_temp_dir("js-runtime-bun-first");
        let bun_dir = root.join("bun-bin");
        let node_dir = root.join("node-bin");
        touch_executable(&node_dir.join("node"));
        touch_executable(&bun_dir.join("bun"));
        let lookup = JsRuntimeLookup {
            override_binary: None,
            bundled_dirs: vec![],
            path_dirs: vec![node_dir.clone(), bun_dir.clone()],
            home: None,
            extra_abs: vec![],
        };
        assert_eq!(resolve_js_runtime(&lookup), bun_dir.join("bun"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn js_runtime_prefers_home_bun_over_path_node() {
        let root = unique_temp_dir("js-runtime-home-bun");
        let home = root.join("home");
        let node_dir = root.join("node-bin");
        touch_executable(&home.join(".bun/bin/bun"));
        touch_executable(&node_dir.join("node"));
        let lookup = JsRuntimeLookup {
            override_binary: None,
            bundled_dirs: vec![],
            path_dirs: vec![node_dir],
            home: Some(home.clone()),
            extra_abs: vec![],
        };
        assert_eq!(resolve_js_runtime(&lookup), home.join(".bun/bin/bun"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn js_runtime_falls_back_to_node_when_bun_missing() {
        let root = unique_temp_dir("js-runtime-node-fallback");
        let node_dir = root.join("bin");
        touch_executable(&node_dir.join("node"));
        let lookup = JsRuntimeLookup {
            override_binary: None,
            bundled_dirs: vec![],
            path_dirs: vec![node_dir.clone()],
            home: Some(root.join("empty-home")),
            extra_abs: vec![],
        };
        assert_eq!(resolve_js_runtime(&lookup), node_dir.join("node"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn js_runtime_falls_back_to_nvm_node_when_bun_missing() {
        let root = unique_temp_dir("js-runtime-nvm");
        let home = root.join("home");
        let node = home.join(".nvm/versions/node/v22.20.0/bin/node");
        touch_executable(&node);
        let lookup = JsRuntimeLookup {
            override_binary: None,
            bundled_dirs: vec![],
            path_dirs: vec![],
            home: Some(home),
            extra_abs: vec![],
        };
        assert_eq!(resolve_js_runtime(&lookup), node);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn js_runtime_skips_bun_when_capability_probe_fails() {
        let root = unique_temp_dir("js-runtime-probe");
        let bun_dir = root.join("bun-bin");
        let node_dir = root.join("node-bin");
        touch_executable(&bun_dir.join("bun"));
        touch_executable(&node_dir.join("node"));
        let lookup = JsRuntimeLookup {
            override_binary: None,
            bundled_dirs: vec![],
            path_dirs: vec![bun_dir.clone(), node_dir.clone()],
            home: None,
            extra_abs: vec![],
        };
        assert_eq!(
            resolve_js_runtime_with_bun_filter(&lookup, |_| false),
            node_dir.join("node")
        );
        assert_eq!(
            resolve_js_runtime_with_bun_filter(&lookup, |_| true),
            bun_dir.join("bun")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn bundled_bun_wins_over_home_and_path() {
        let root = unique_temp_dir("js-runtime-bundled-bun");
        let bundled = root.join("app/runtimes");
        let home = root.join("home");
        let path_dir = root.join("path");
        touch_executable(&bundled.join("bun"));
        touch_executable(&home.join(".bun/bin/bun"));
        touch_executable(&path_dir.join("bun"));
        touch_executable(&path_dir.join("node"));
        let lookup = JsRuntimeLookup {
            override_binary: None,
            bundled_dirs: vec![bundled.clone()],
            path_dirs: vec![path_dir],
            home: Some(home),
            extra_abs: vec![],
        };
        assert_eq!(resolve_js_runtime(&lookup), bundled.join("bun"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn bundled_node_wins_when_bundled_bun_fails_probe() {
        let root = unique_temp_dir("js-runtime-bundled-node");
        let bundled = root.join("app/runtimes");
        let home = root.join("home");
        touch_executable(&bundled.join("bun"));
        touch_executable(&bundled.join("node"));
        touch_executable(&home.join(".nvm/versions/node/v22.20.0/bin/node"));
        let lookup = JsRuntimeLookup {
            override_binary: None,
            bundled_dirs: vec![bundled.clone()],
            path_dirs: vec![],
            home: Some(home),
            extra_abs: vec![],
        };
        assert_eq!(
            resolve_js_runtime_with_bun_filter(&lookup, |_| false),
            bundled.join("node")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn tauri_bundle_ships_vendor_runtimes() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        assert_eq!(conf["bundle"]["resources"]["../vendor/runtimes"], "runtimes");
        let before = conf["build"]["beforeBuildCommand"].as_str().unwrap_or("");
        assert!(
            before.contains("fetch:runtimes"),
            "beforeBuildCommand must vendor runtimes: {before}"
        );
    }

    #[test]
    fn bun_host_process_args_force_bun_runtime_without_dotenv() {
        assert!(is_bun_executable(Path::new("/Users/me/.bun/bin/bun")));
        assert!(is_bun_executable(Path::new("bun.exe")));
        assert!(!is_bun_executable(Path::new("/usr/bin/node")));
        assert_eq!(
            host_process_args(Path::new("/opt/homebrew/bin/bun"), Path::new("/app/host/dist/main.js")),
            vec![
                "--bun".to_string(),
                "--no-env-file".to_string(),
                "--no-install".to_string(),
                "/app/host/dist/main.js".to_string()
            ]
        );
        assert_eq!(
            host_process_args(Path::new("/usr/bin/node"), Path::new("/app/host/dist/main.js")),
            vec!["/app/host/dist/main.js".to_string()]
        );
    }

    #[test]
    fn main_window_config_defers_creation_to_setup() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let main = conf["app"]["windows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|window| window["label"] == "main")
            .expect("main window");
        assert_eq!(main["create"], false);
        let lib = include_str!("lib.rs");
        assert!(lib.contains("create_main_window(app)?"));
        assert!(lib.contains("WebviewWindowBuilder::from_config"));
        assert!(!lib.contains("if let Some(existing) = app.get_webview_window(\"main\")"));
        let create = lib
            .find("create_main_window(app)?")
            .expect("setup must create the main window");
        let spawn = lib
            .find("spawn_host_bridge(handle.clone());")
            .expect("setup must spawn the Host bridge");
        assert!(
            create < spawn,
            "create_main_window must run before spawn_host_bridge so shell.mount can find main"
        );
        let mount_arm = lib
            .split("\"shell.mount\" =>")
            .nth(1)
            .expect("shell.mount arm")
            .split("\"shell.")
            .next()
            .expect("shell.mount arm end");
        assert!(
            mount_arm.contains("run_on_main_thread"),
            "shell.mount must hop to the UI thread before navigating the hidden splash"
        );
        assert!(mount_arm.contains("mount_main_window"));
    }

    #[test]
    fn traffic_lights_use_frame_height_not_default_inset() {
        let lib = include_str!("lib.rs");
        assert!(lib.contains("macos_traffic_light_wry_inset_y"));
        assert!(lib.contains("apply_traffic_light_chrome"));
        assert!(!lib.contains("y: 12.0"));
    }

    #[test]
    fn macos_dock_reopen_reveals_the_hidden_main_window() {
        let lib = include_str!("lib.rs");
        assert!(lib.contains("RunEvent::Reopen"));
        assert!(lib.contains("application_needs_reveal"));
        assert!(lib.contains("reveal_main_window"));
    }

    #[test]
    fn plugin_root_prefers_local_dotted_checkout() {
        let root = dsh_plugin_desktop_root(None);
        assert!(
            root.ends_with(".anywhere-labs-dsh-desktop/dsh-plugin-desktop")
                || root.ends_with("anywhere-labs-dsh-desktop/dsh-plugin-desktop")
                || root.join("lib/tauri-host.js").exists(),
            "{}",
            root.display()
        );
    }

    #[test]
    fn spawn_host_creates_missing_user_data_dir() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let dir = std::env::temp_dir().join(format!(
            "dsh-host-ud-{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        assert!(!dir.exists());
        let entry = host_entry_path();
        assert!(entry.exists(), "{}", entry.display());
        let mut child = spawn_host(&entry, &dir, false, None).expect("spawn host");
        let created = dir.is_dir();
        let _ = child.kill();
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(created);
    }

    #[cfg(unix)]
    #[test]
    fn spawn_host_invokes_bun_runtime_with_compat_flags() {
        let dir = unique_temp_dir("spawn-bun");
        let stamp = dir.join("stamp");
        let runtime = dir.join("bun");
        std::fs::write(
            &runtime,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$0\" \"$@\" > '{}'\nexit 0\n",
                stamp.display()
            ),
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o755)).unwrap();
        let entry = dir.join("main.js");
        std::fs::write(&entry, "void 0;\n").unwrap();
        let user_data = dir.join("ud");
        let mut child = spawn_host_with(&entry, &user_data, false, None, &runtime).expect("spawn");
        let _ = child.wait();
        let recorded = std::fs::read_to_string(&stamp).unwrap_or_default();
        let created = user_data.is_dir();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(created);
        assert!(recorded.contains("--bun"), "{recorded}");
        assert!(recorded.contains("--no-env-file"), "{recorded}");
        assert!(recorded.contains("--no-install"), "{recorded}");
        assert!(recorded.contains("main.js"), "{recorded}");
    }
}
