---
status: archived
---

# 旧形态（Tauri 壳 + 内置 JS Host）的经验沉淀

> 来源：已删除的 `docs/`（2026-08 编写）。当时的架构是：壳内置 Bun/Node 运行时和 JS Host，通过 `dsh-plugin-desktop` 适配器启动 DSH，内核用 `kernel-pin.json` 锁定在 `dsh-v0.1.1-rc.2`。2026-11-10 改为启动本机 `dsh web`（见 `.trellis/spec/project/architecture.md`），这里只保留以后还可能用到的结论。旧代码在 `src-tauri/legacy/`、`host/`。

## 为什么放弃

- 锁定版本的方案跟不上 DSH 的发版：pin 停留在 0.1.1-rc.2，而 npm 上已经到了 0.2.x；`dsh-plugin-desktop` 还依赖上游已经删掉的包（`dsh-host-apiproxy`、`dsh-client-runtime`）。
- 内置运行时、同步 Host、生成 build profile、开发模式监听（`/_dsh/dev/*`、`devtools/*.ndjson`）这一整套都跟着废弃。

## 向 DSH 页面注入脚本的约定（以后如需恢复可参考）

旧壳在主窗口每次页面加载完成后注入 ES5 IIFE，做过这些适配：设置 / 插件市场弹窗改为满窗口、暗色主题令牌覆盖、输入器权限菜单中文化、上下文面板重排、设置写入冲突时重试一次。积累下来的约定：

- 锚点只用语义属性和结构签名（`role`、`aria-*`、`data-*`），不用 CSS-module 的 hash 类名；找不到锚点就什么都不做，静默回退到原样。
- 用 `window.__XXX__` 做幂等守卫；所有写操作先比对、后写入；MutationObserver 只监听 `childList`，配合 rAF 合并到一帧处理，避免脚本自己的写操作触发反馈循环。
- 换肤优先覆盖内核的 `--dsw-*` 设计令牌（官方提供的扩展点），不改组件样式。
- 设置写入冲突：内核的 revision 是内存计数。只对 `settings.mutate` / `settings.update` 用 `details.actual` 重试一次；**`settings.replace` 永不重试**，否则会覆盖其他写入者并发写入的内容。
- 代理重写要按 authority（`u.host`）匹配，不能按 origin：WebKit 计算 `ws:` URL 的 origin 时与 http 不同；相对路径 `/api/...` 也要补上密钥，否则 WebSocket 事件流会 404。

## 产品形态缺口记录（相对 Electron 版）

- P0 首次设置向导（模式、浏览器访问、网络暴露、Market、通知），旧壳没有接入。
- 参考版的结构性差距：侧栏按项目分组、⌘K 命令面板、顶栏任务标题和分支选择器、会话多选删除——这些都需要改造 DOM，不适合放在注入层做。
- 额度功能做成了独立插件 `dsh-quota`（与 `dsh-usage-stats` 同构，单价单位为 u / 1M token，支持 5 小时滚动窗口和每周窗口），没有放进壳里。

## 企业化调研结论（2026-08-26）

- 官方内核没有企业能力（多租户、计费、管理后台都没有）。企业落地目前有两条路：云平台托管（火山引擎 AgentKit），或者用社区插件自己拼一套治理组合（对账、可观测、审批、供应链扫描如 HOL Guard、沙箱）。
- Codex、Cursor、Claude Code 三家的企业后台都收敛到九个功能域。与传统后台的两个分水岭：一是**管控 agent 的执行行为**（集中下发沙箱、审批、网络出口、工具白名单），二是**非人类身份**（service account / 自动化）。
- 市场空位：「自托管团队网关 + 本地桌面端纳管」还没有人做。
- 办公类插件很零散（文档、邮件、日历、IM、桌面自动化都有），但没有成型的产品层；其中的纯逻辑工具层可以改造成 Skill / MCP 包。
