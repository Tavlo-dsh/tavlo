# 项目规则（Tavlo）

> Tavlo 是 DeepSeek Harness（dsh）的 Tauri v2 桌面壳：启动本机环境里的 `dsh web`，用 WebView 展示。

| 规则 | 内容 | 什么时候读 |
| --- | --- | --- |
| [架构边界](./architecture.md) | 壳的职责、DSH 版本来源、内核与功能扩展的归属、安全边界 | 改 `src-tauri/`、`native-ui/`，或要加新功能时 |
| [开发与文档约定](./workflow.md) | TDD、文档只写优先级、同一事实只写一处、AGENTS.md 修改需同意 | 每次开发、写文档时 |
| [命名与打包](./packaging.md) | 产品名 / 标识符 / 产物命名、Windows 架构、安装版与便携版 | 改名、打包、发版时 |
