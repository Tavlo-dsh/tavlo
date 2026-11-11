<div align="center">

<img src="src-tauri/icons/icon.png" width="96" alt="Tavlo logo" />

# Tavlo

**DeepSeek Harness（dsh）的 Tauri v2 桌面壳：启动本机环境中的 `dsh web`，用 WebView 展示。**

</div>

Tavlo 不打包、不锁定 DSH 版本。用哪个版本的 DSH，由用户环境里安装的 `dsh` 决定；升级 DSH 只需 `npm i -g @deepseek-ai/dsh@latest`，不用重新发布桌面端。

## 架构

```text
Tauri v2 壳（Rust，src-tauri/）
  ├─ 定位 dsh：DSH_BIN 环境变量 > PATH 上的 dsh
  │    └─ npm / pnpm 的 dsh.cmd shim 会解析成 node + bin.js 直接运行（无 cmd.exe 黑窗）
  ├─ dsh --version          → 识别当前环境的 DSH 版本
  ├─ dsh web --no-open --port 0
  │    └─ Windows Job Object：壳退出 / 崩溃 / 被强杀时，dsh 整棵进程树一并结束
  ├─ 解析 stdout 的 "dsh web: http://127.0.0.1:<port>/?token=…" → 主窗口导航过去
  └─ 托盘（显示 / 重启 DSH / 打开日志 / 退出）、单实例、启动失败页、便携模式
```

- dsh 的 Web 页面是 loopback 远程内容，**不授予任何 Tauri IPC**（capability 只覆盖本地打包页面，没有 `remote`）。
- 非 loopback 的链接、`target=_blank` 外链交给系统浏览器打开。
- DSH 的工作目录是用户主目录；数据仍在 `~/.dsh`，与命令行 `dsh web` 共享 profile 和会话。

| 目录 | 内容 |
| --- | --- |
| `src-tauri/src/` | 壳：`dsh_locate`（定位）、`dsh_process`（启动/Job Object）、`dsh_web`（就绪行/导航策略）、`portable`（数据目录） |
| `native-ui/` | 本地页面：启动页、启动失败页 |
| `scripts/package-windows.mjs` | Windows 打包：安装版 + 便携版 |
| `src-tauri/legacy/`、`host/`、`vendor/` | 旧的 JS Host 形态（不参与构建，仅供移植功能时参考） |
| `.trellis/spec/` | 项目规则：架构边界、开发约定、命名与打包 |

## 运行前提（用户机器）

1. Node.js ≥ 24.9（`@deepseek-ai/dsh` 的要求）
2. `npm i -g @deepseek-ai/dsh`，或设置环境变量 `DSH_BIN` 指向 `dsh` / `dsh.cmd` / `bin.js`
3. WebView2 Runtime（Windows 10/11 通常自带；安装版缺失时会自动下载）

## 开发

需要 Node、pnpm、Rust（MSVC 工具链）。

```bash
pnpm install
pnpm dev            # = tauri dev
pnpm test:shell     # Rust 单元测试
```

启动日志：`%LOCALAPPDATA%\com.tavlo.desktop\logs\dsh-web.log`（便携版在 `data\logs\`；token 已脱敏）。

## Windows 打包

```bash
pnpm package:win                    # x64，Intel / AMD 通用
pnpm package:win --arch arm64       # Windows on ARM（需 rustup target add aarch64-pc-windows-msvc 与 MSVC ARM64 工具）
pnpm package:win --arch x64,arm64
```

产物在 `dist/windows/`：

| 文件 | 说明 |
| --- | --- |
| `Tavlo_<版本>_<arch>-setup.exe` | NSIS 安装版（当前用户安装，无需管理员） |
| `Tavlo_<版本>_<arch>_portable.zip` | 便携版：`Tavlo.exe` + `portable` 标记文件；WebView 数据与日志写在同目录 `data\` |

## 项目规则

开发约定、架构边界和命名打包规则在 [`.trellis/spec/project/`](.trellis/spec/project/index.md)；旧形态的经验与调研结论归档在 `.trellis/research/archive/`。

## 许可

[MIT](LICENSE)。最初基于 Apache-2.0 的 [rhythm1995/dsh-desktop](https://github.com/rhythm1995/dsh-desktop) 改造，沿用部分见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
