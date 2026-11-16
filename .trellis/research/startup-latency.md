# Windows 启动延迟测量

## 已测结果

- 2026-11-13，在当前 Windows 本机直接运行 Node 24.18.1 和 DSH 0.2.2-rc.1，以捕获 `dsh web:` 就绪行计时；此次只启动临时诊断进程，收到就绪信号后结束进程，未修改现有 DSH profile。
- 当前 Tavlo profile 从冷文件缓存到 Web 服务就绪约 24 秒；后续预热测量约 10.8–11 秒。收到就绪行后，对 loopback 页面发起 HTTP 请求再耗时约 1.3 秒。版本查询热启动约 0.15 秒。
- 使用隔离的临时 `DSH_HOME`，仅启用 DSH 官方 `base` 和 `web` bundles、空用户 patch，预热后启动约 9.3–9.7 秒。相比当前 profile 的差距约 1–2 秒；profile 和 patch 同时改变，因此差值不能归因于某个自定义插件。
- Node Inspector CPU profile 的主要热点是 ESM 模块查找、文件系统路径检查和源码编译。实验性 `NODE_COMPILE_CACHE` 重复试跑为约 14–16 秒，未显示启动收益；不要据此把编译缓存默认加入 Tavlo。

## MCP 单变量对照

- 用两个独立的临时 `DSH_HOME`，从同一现有 DSH profile 复制完全相同的 bundle 和 patch 配置；唯一变量是临时副本是否包含 streamable HTTP MCP 条目。保留 MCP 的副本试跑 4 次；移除 MCP 配置的副本试跑 3 次。测试未修改现有 profile。
- 首次保留 MCP 的冷试跑约 68.6 秒，而首次无 MCP 试跑约 10.0 秒。后续保留 MCP 的 3 次分别约 10.2、14.4、11.8 秒；无 MCP 的 2 次约 13.9、11.9 秒。一次额外保留 MCP 的捕获试跑约 15.4 秒，未记录连接失败、请求失败或重连告警。
- 首次 68.6 秒是值得关注的异常值，但后续结果没有重现稳定的 MCP 耗时差异；因为没有捕获该次超长启动的阶段日志，不能归因于 MCP 服务器。移除 MCP 不是已验证的启动优化，也会失去该服务提供的工具。

## 结论与限制

- 主要延迟在 `dsh web` 启动，不在 Tavlo 的 `dsh --version` 查询；该实现的版本查询只占本次热启动约 0.15 秒。
- 官方 DSH 在 `runProfile` 等待 profile boot；web 插件在 loader settle 并完成启动检查后才输出已认证 URL。就绪时间因而包含 DSH 及其启动 bundle 的加载。
- 本机 profile 含 streamable HTTP MCP 插件。已安装 DSH 的 `dsh-mcp-client` 在 `apply` 中等待初次连接和工具同步完成，再结束插件启动；MCP 超时理论上可能拖长启动。对照中保留 MCP 和无 MCP 的后续耗时相近；仅一次 68.6 秒长尾无法归因于 MCP。若用户端仍频繁遇到长尾，应加入分阶段计时并从 MCP 服务可用性和连接日志开始定位；不要建议为提速而永久移除 MCP。
- 本机 `tavlo-plugins-claude` 的 `src/index.ts` 在顶层静态导入 `@anthropic-ai/claude-agent-sdk`；唯一运行时调用在会话 `startQuery` 中。采样中观察到 5 个 SDK 模块、约 46ms 自身采样 CPU；这不是总体导入耗时或动态导入收益。按需加载仍未独立对照，也不能视为已验证的提速项。
- 约 9–10 秒的最小 profile 热启动表明，主要基础耗时在 DSH 自身启动与 bundle/loader 加载路径。MCP A/B 没有证实稳定的额外启动耗时；本机扩展是否增加了少量开销，仍未单独测定。
- 本文单次本机诊断不构成不同机器上的启动时限保证。未修改或重建 DSH；保持壳使用用户环境中安装的 DSH。
