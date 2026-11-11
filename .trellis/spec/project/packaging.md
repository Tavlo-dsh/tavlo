# 命名与打包

## 命名

| 项 | 值 |
| --- | --- |
| 产品名 / 窗口标题 / 托盘提示 | `Tavlo` |
| npm 包名 | `tavlo-dsh` |
| Cargo 包 / 可执行文件 / lib | `tavlo` / `tavlo.exe` / `tavlo_lib` |
| 应用标识符 | `com.tavlo.desktop`（决定 `%LOCALAPPDATA%\com.tavlo.desktop\` 下的日志与 WebView 数据目录） |

改名时这些位置要一起改：`package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`native-ui/*.html` 的 `<title>`、`lib.rs` 的托盘提示。打包脚本从 `Cargo.toml` 读可执行文件名，从 `tauri.conf.json` 读产品名和版本，不在脚本里写死名字。

## Windows 产物

- Intel 和 AMD 都是 x64，共用同一个产物。ARM64（Windows on ARM）是另外一个可选目标，用 `--arch arm64` 构建。
- `pnpm package:win [--arch x64|arm64|x64,arm64]`，产物在 `dist/windows/`：
  - `Tavlo_<版本>_<arch>-setup.exe`：NSIS 安装版，装在当前用户下，不需要管理员权限，缺少 WebView2 时会下载引导程序；
  - `Tavlo_<版本>_<arch>_portable.zip`：便携版，内含 `Tavlo.exe` 和 `portable` 标记文件。exe 同目录下存在 `portable` 文件时，WebView 数据和日志写到同目录的 `data\` 里。
- 安装包里不包含 DSH 和 Node：用户机器需要 Node.js ≥ 24.9，并已执行 `npm i -g @deepseek-ai/dsh`（或设置 `DSH_BIN`）。
