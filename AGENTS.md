# 项目说明
- Tavlo：DeepSeek Harness（dsh）的 Tauri v2 桌面壳。启动本机环境中的 `dsh web`，用 WebView 展示；DSH 版本由用户环境决定，壳不打包、不锁版本
- `.deepseek-harness` 是官方内核的只读对照检出（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，原封不动）
- 除非我要求，否则你不能自行更新 AGENTS.md，更新该文件必须和我请求同意

# 原则
- 项目规则（架构边界、开发与文档约定、命名与打包）见 `.trellis/spec/project/index.md`

# 目录
- `src-tauri/src/`：壳（`dsh_locate` 定位 dsh、`dsh_process` 启动与 Job Object、`dsh_web` 就绪行与导航策略、`portable` 数据目录、`lib.rs` 窗口/托盘接线）
- `native-ui/`：本地页面（启动页、启动失败页）
- `scripts/package-windows.mjs`：Windows 打包（安装版 + 便携版）
- `src-tauri/legacy/`、`host/`、`vendor/`：旧 JS Host 形态，不参与构建，仅供参考

# 常用命令
- `pnpm dev`：本地启动（需本机已装 Node.js ≥ 24.9 与 `npm i -g @deepseek-ai/dsh`，或设置 `DSH_BIN`）
- `pnpm test:shell`：Rust 单元测试
- `pnpm package:win [--arch x64|arm64|x64,arm64]`：产物在 `dist/windows/`

<!-- TRELLIS:START -->
# mini-trellis

This project uses mini-trellis as a memory layer. Working knowledge lives under `.trellis/`:

- `.trellis/spec/` — durable contracts (short markdown; read `index.md` first)
- `.trellis/research/` — topic inbox (`<topic>.md`; `README.md` is not a topic)
- `.trellis/workspace/` — per-developer journals

Record a session with `/mini-trellis:remember` (Claude/OpenCode), `/mini-trellis-remember` (Pi), `$mini-trellis-remember` (Codex/ZCode), or the `mini-trellis-remember` skill (Cursor and DeepSeek Harness). When earlier decisions or relevant project rules are needed, use `mini-trellis mem recall "<topic or path>"`; expand evidence with `mini-trellis mem read "<ref>"`. No search is required for unrelated work. Promote lasting boundaries into spec with `mini-trellis-update-spec`.

Record only confirmed decisions, reusable research findings, or the session/compact handoff. Skip ordinary turns and unconfirmed guesses. New installs write notes without an automatic git commit; use `mini-trellis doctor` to check host wiring and `mini-trellis refresh --dry-run` before refreshing assets.

Keep confirmed rules short and faithful. Unconfirmed scope, exceptions, and implementation choices stay open or are labeled as inference, not added to the contract.

For a confirmed update, follow this short order: read the existing topic; edit that file; read it back and check the new rule, limits, and negations; run `python3 ./.trellis/scripts/add_session.py --title "..." --summary "..." --topic <actual-topic-path>`; read the journal and check its topic link. Journal-only success is not topic success; report partial writes accurately. New notes follow the requested or discussion language; updates preserve the document language.

When recall excerpts already answer the question with source and qualifiers, cite them and stop. Expand only missing context; do not repeat a lookup or fall back to dialogue-only `search` merely to reconfirm sufficient evidence.

ZCode conversation history is not parsed; use project knowledge or supply Markdown/text exports. For an explicit request to organize selected past sessions or supplied Markdown/text exports into project knowledge, use `mini-trellis-session-insight`; update existing documents and preserve sources.

mini-trellis does not create or drive tasks.

Managed by mini-trellis. Edits outside this block are preserved.
<!-- TRELLIS:END -->
