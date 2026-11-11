//! 在当前运行环境中定位 `dsh` 启动器。DSH 版本完全由本机安装决定，壳不打包、不锁版本。
//!
//! 优先级：
//! 1. `DSH_BIN` 环境变量（可执行文件、`.cmd` shim 或 `bin.js`）。
//! 2. `PATH` 上的 `dsh`：
//!    - Windows npm / pnpm 全局 shim（`dsh.cmd`）：解析出真实的 `bin.js`，用 node 直接运行，
//!      避免经过 cmd.exe（无控制台闪烁、进程树干净）；
//!    - 其他可执行文件（`dsh.exe`、Unix `dsh`）直接运行。

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DshLauncher {
    /// 实际执行的程序（node 或 dsh 本身）。
    pub program: PathBuf,
    /// 放在 dsh 参数之前的参数（node 方式时为 `bin.js`）。
    pub prefix_args: Vec<OsString>,
    /// 给用户看的来源说明（找到的 dsh 路径）。
    pub found_at: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum LocateError {
    /// `DSH_BIN` 指向的文件不存在。
    OverrideMissing(PathBuf),
    /// `bin.js` 需要 node，但环境中找不到 node。
    NodeMissing(PathBuf),
    /// PATH 上没有 dsh。
    NotFound,
}

impl std::fmt::Display for LocateError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LocateError::OverrideMissing(path) => write!(f, "DSH_BIN 指向的文件不存在：{}", path.display()),
            LocateError::NodeMissing(entry) => write!(f, "找到了 {}，但 PATH 上没有 node", entry.display()),
            LocateError::NotFound => write!(f, "当前环境的 PATH 中找不到 dsh 命令"),
        }
    }
}

pub fn locate(env_override: Option<OsString>, path_var: Option<OsString>) -> Result<DshLauncher, LocateError> {
    let dirs: Vec<PathBuf> = path_var
        .map(|value| std::env::split_paths(&value).collect())
        .unwrap_or_default();
    locate_in(env_override.map(PathBuf::from), &dirs, cfg!(windows))
}

/// 可测试的核心逻辑：`windows` 决定按哪种文件名查找。
pub fn locate_in(override_path: Option<PathBuf>, path_dirs: &[PathBuf], windows: bool) -> Result<DshLauncher, LocateError> {
    if let Some(path) = override_path.filter(|path| !path.as_os_str().is_empty()) {
        if !path.is_file() {
            return Err(LocateError::OverrideMissing(path));
        }
        return launcher_for(&path, path_dirs, windows);
    }

    let names: &[&str] = if windows { &["dsh.cmd", "dsh.exe", "dsh.bat"] } else { &["dsh"] };
    for dir in path_dirs {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return launcher_for(&candidate, path_dirs, windows);
            }
        }
    }
    Err(LocateError::NotFound)
}

fn launcher_for(found: &Path, path_dirs: &[PathBuf], windows: bool) -> Result<DshLauncher, LocateError> {
    let ext = found
        .extension()
        .map(|ext| ext.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    let script = match ext.as_str() {
        "js" | "mjs" | "cjs" => Some(found.to_path_buf()),
        "cmd" | "bat" => cmd_shim_target(found),
        _ => None,
    };

    if let Some(entry) = script {
        let node = node_near(found, path_dirs, windows).ok_or_else(|| LocateError::NodeMissing(entry.clone()))?;
        return Ok(DshLauncher {
            program: node,
            prefix_args: vec![entry.into_os_string()],
            found_at: found.to_path_buf(),
        });
    }

    // 解析不了的 shim / 原生可执行文件：直接运行（Rust 会为 .cmd 正确调用 cmd.exe）。
    Ok(DshLauncher {
        program: found.to_path_buf(),
        prefix_args: Vec::new(),
        found_at: found.to_path_buf(),
    })
}

/// 从 npm / pnpm 生成的 `.cmd` shim 中找出被包装的 JS 入口。
/// shim 中的路径形如 `"%dp0%\node_modules\@deepseek-ai\dsh\lib\bin.js"` 或 `"%~dp0\..\bin.js"`。
pub fn cmd_shim_target(shim: &Path) -> Option<PathBuf> {
    let dir = shim.parent()?;
    let text = fs::read_to_string(shim).ok()?;
    for token in text.split('"') {
        let lower = token.to_ascii_lowercase();
        if !(lower.ends_with(".js") || lower.ends_with(".mjs") || lower.ends_with(".cjs")) {
            continue;
        }
        let relative = ["%~dp0", "%dp0%"]
            .iter()
            .find_map(|marker| lower.find(marker).map(|index| &token[index + marker.len()..]));
        let candidate = match relative {
            Some(rest) => dir.join(rest.trim_start_matches(['\\', '/'])),
            None => PathBuf::from(token),
        };
        if candidate.is_file() {
            return Some(normalize(&candidate));
        }
    }
    // 兜底：npm 全局安装的固定布局。
    let conventional = dir.join("node_modules").join("@deepseek-ai").join("dsh").join("lib").join("bin.js");
    conventional.is_file().then_some(conventional)
}

/// shim 同目录的 node（npm 惯例），否则 PATH 上的 node。
fn node_near(found: &Path, path_dirs: &[PathBuf], windows: bool) -> Option<PathBuf> {
    let name = if windows { "node.exe" } else { "node" };
    found
        .parent()
        .map(|dir| dir.join(name))
        .filter(|path| path.is_file())
        .or_else(|| path_dirs.iter().map(|dir| dir.join(name)).find(|path| path.is_file()))
}

/// 去掉 `..` / `.` 片段（不访问文件系统，避免 Windows `\\?\` 前缀）。
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let dir = std::env::temp_dir().join(format!(
                "dsh-locate-test-{}-{}",
                std::process::id(),
                SEQ.fetch_add(1, Ordering::SeqCst)
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn file(&self, rel: &str, content: &str) -> PathBuf {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, content).unwrap();
            path
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const NPM_SHIM: &str = "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST \"%dp0%\\node.exe\" (\r\n  SET \"_prog=%dp0%\\node.exe\"\r\n) ELSE (\r\n  SET \"_prog=node\"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js\" %*\r\n";

    #[test]
    fn npm_shim_resolves_to_node_and_bin_js() {
        let tmp = TempDir::new();
        let shim = tmp.file("global/dsh.cmd", NPM_SHIM);
        let entry = tmp.file("global/node_modules/@deepseek-ai/dsh/lib/bin.js", "");
        let node = tmp.file("global/node.exe", "");

        let launcher = locate_in(None, &[tmp.0.join("global")], true).unwrap();
        assert_eq!(launcher.program, node);
        assert_eq!(launcher.prefix_args, vec![normalize(&entry).into_os_string()]);
        assert_eq!(launcher.found_at, shim);
    }

    #[test]
    fn pnpm_style_shim_with_parent_dirs() {
        let tmp = TempDir::new();
        tmp.file(
            "pnpm/dsh.cmd",
            "@SETLOCAL\r\n@IF EXIST \"%~dp0\\node.exe\" (\r\n  \"%~dp0\\node.exe\"  \"%~dp0\\..\\store\\dsh\\lib\\bin.js\" %*\r\n) ELSE (\r\n  node  \"%~dp0\\..\\store\\dsh\\lib\\bin.js\" %*\r\n)\r\n",
        );
        let entry = tmp.file("store/dsh/lib/bin.js", "");
        let node = tmp.file("nodejs/node.exe", "");

        let launcher = locate_in(None, &[tmp.0.join("pnpm"), tmp.0.join("nodejs")], true).unwrap();
        assert_eq!(launcher.program, node);
        assert_eq!(launcher.prefix_args, vec![normalize(&entry).into_os_string()]);
    }

    #[test]
    fn shim_without_node_reports_node_missing() {
        let tmp = TempDir::new();
        tmp.file("global/dsh.cmd", NPM_SHIM);
        tmp.file("global/node_modules/@deepseek-ai/dsh/lib/bin.js", "");
        let err = locate_in(None, &[tmp.0.join("global")], true).unwrap_err();
        assert!(matches!(err, LocateError::NodeMissing(_)));
    }

    #[test]
    fn unknown_shim_runs_directly() {
        let tmp = TempDir::new();
        let shim = tmp.file("bin/dsh.cmd", "@echo off\r\nsomething-else %*\r\n");
        let launcher = locate_in(None, &[tmp.0.join("bin")], true).unwrap();
        assert_eq!(launcher.program, shim);
        assert!(launcher.prefix_args.is_empty());
    }

    #[test]
    fn exe_runs_directly_and_path_order_wins() {
        let tmp = TempDir::new();
        let first = tmp.file("a/dsh.exe", "");
        tmp.file("b/dsh.exe", "");
        let launcher = locate_in(None, &[tmp.0.join("missing"), tmp.0.join("a"), tmp.0.join("b")], true).unwrap();
        assert_eq!(launcher.program, first);
    }

    #[test]
    fn unix_looks_for_plain_dsh() {
        let tmp = TempDir::new();
        tmp.file("bin/dsh.cmd", NPM_SHIM);
        assert_eq!(locate_in(None, &[tmp.0.join("bin")], false).unwrap_err(), LocateError::NotFound);
        let plain = tmp.file("bin/dsh", "#!/bin/sh\n");
        assert_eq!(locate_in(None, &[tmp.0.join("bin")], false).unwrap().program, plain);
    }

    #[test]
    fn override_takes_priority() {
        let tmp = TempDir::new();
        tmp.file("path/dsh.exe", "");
        let entry = tmp.file("custom/bin.js", "");
        let node = tmp.file("node/node.exe", "");
        let launcher = locate_in(Some(entry.clone()), &[tmp.0.join("path"), tmp.0.join("node")], true).unwrap();
        assert_eq!(launcher.program, node);
        assert_eq!(launcher.prefix_args, vec![entry.into_os_string()]);
    }

    #[test]
    fn missing_override_is_an_error() {
        let tmp = TempDir::new();
        let missing = tmp.0.join("nope.exe");
        assert_eq!(locate_in(Some(missing.clone()), &[], true).unwrap_err(), LocateError::OverrideMissing(missing));
    }

    #[test]
    fn nothing_found() {
        let tmp = TempDir::new();
        assert_eq!(locate_in(None, &[tmp.0.clone()], true).unwrap_err(), LocateError::NotFound);
    }
}
