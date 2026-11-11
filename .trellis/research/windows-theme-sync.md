# Windows 标题栏与页面主题同步

## 已否定的处理

- 在 `tauri.conf.json` 中固定 `theme: Dark` 只能匹配深色启动页；DSH 加载浅色页面后仍会出现深浅不一致。用户要求动态同步，不能恢复固定深色方案。
- Windows 上使用 Tauri 的整窗 `set_theme` 会关联 WebView 配色偏好，可能影响页面的“跟随系统”模式。当前只调整 DWM 标题栏属性。

## 实现与验证依据

- `src-tauri/src/read-page-theme.js` 是原生端主动求值的只读 CSS 取色表达式，不注册页面回调、不写 DSH DOM 或设置。
- `src-tauri/src/page_theme.rs` 只接受三个 RGB 字节，根据亮度分类；无效、缺失、超长值都不改变窗口主题。
- `src-tauri/src/lib.rs` 每约 300 毫秒取色并更新 Windows DWM 属性；忽略导航期间旧页面的结果。仅在实际模式不同时更新，不改变 WebView 的系统配色偏好。求值回调使用 Tauri 2.11 的 `eval_with_callback`，因此 Cargo 最低版本已设为 2.11。
- 本地 CSS 通过 `prefers-color-scheme` 同时提供浅色和深色；原生窗口背景在显示前匹配系统。
- 25 项 Rust 测试通过。真实 WebView 中临时切换 DSH 的页面配色选择器，读取 DWM 属性，验证深色 → 浅色双向跟随，且 `matchMedia('(prefers-color-scheme: dark)')` 保持不变；验证后已恢复页面原状，未写入 DSH 偏好。
- 用户确认界面显示正确。远程 DSH 页调用只读 `app.name` 仍被原有本地 capability 拒绝；未增加远程权限或壳命令。正式包已重新构建，临时调试端口仅用于验证，不进入正式配置。

正式约定见 [.trellis/spec/project/architecture.md](../spec/project/architecture.md)。Windows 是本次实际验证的平台。
