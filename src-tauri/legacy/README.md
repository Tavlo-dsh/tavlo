# legacy/

旧的 JS Host 形态 Rust 壳（JSON-RPC stdio + `dsh-plugin-desktop` 适配器 + 内核 pin）。
已不参与编译，仅作参考：窗口记忆、拖放路径、主题/材质、对话框等功能需要时可从这里移植。

当前形态：壳直接启动本机环境中的 `dsh web`，WebView 加载其打印的 URL。见 `src-tauri/src/`。
