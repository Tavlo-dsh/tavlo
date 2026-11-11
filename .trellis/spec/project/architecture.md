# 架构边界

## 壳只做原生职责

- 壳（`src-tauri/`）负责：定位并启动 dsh、管理 dsh 进程树、窗口、托盘、单实例、启动页 / 失败页（`native-ui/`）、便携模式、打包。
- Windows 标题栏动态跟随当前页面的明暗模式；本地启动页 / 失败页跟随系统。主题同步仅由原生端读取页面配色，不改 DSH 的主题偏好、不向远程页面授予 Tauri IPC。
- 产品功能（agent 切换、额度、统计等）做成 **DSH 插件**，不做进壳里，也不靠往 DSH 页面注入脚本实现。

## DSH 版本由运行环境决定

- 壳不打包、不锁定 DSH 版本。使用的是本机安装的 `dsh`：`DSH_BIN` 环境变量优先，其次是 PATH 上的 `dsh`。
- 启动方式是 `dsh web --no-open --port 0`，解析 stdout 的 `dsh web: <url>` 就绪行，然后让主窗口导航到这个地址。
- 不恢复旧方案：内核 pin（`kernel-pin.json`）、内置 JS Host、内置 Bun/Node 运行时、`dsh-plugin-desktop` 适配器。旧代码只作参考，放在 `src-tauri/legacy/`。

## 内核原封不动

- `.deepseek-harness/` 是官方内核的本地检出，只用来读源码对照，不改它的任何已跟踪文件，也不进本仓库。
- `.anywhere-labs-dsh-desktop/` 是可选的 Electron 形态对照。它不是上游；参考它的产品形态时，改写到 `src-tauri/`、`native-ui/`，不翻译 Electron API（`webPreferences`、asar、`ELECTRON_RUN_AS_NODE`、`BrowserWindow` 选项袋等都不搬）。

## 安全边界

- dsh 的 Web 页面属于 loopback 上的远程内容，**不授予任何 Tauri IPC**：capability 只覆盖本地打包页面（`local: true`），不加 `remote`。
- 只有本地页面可以调用壳命令。命令要少且不带参数；需要参数时，必须校验。
- 主窗口只允许导航到本地页面和 loopback 地址；其他 http(s) 链接以及 `target=_blank` 外链交给系统浏览器打开；其余一律拒绝。
- CSP 保持严格；日志里出现的 `token=` 必须打码。
- 壳退出、崩溃或被强杀时，dsh 的整棵进程树都要一起结束（Windows 用 Job Object）。
