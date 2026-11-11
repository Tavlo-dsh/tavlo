# Windows 图标资源与增量构建

## 已确认的问题

- 原有 `src-tauri/icons/icon.ico` 已更新，但打包 exe 的 Windows 图标资源仍是旧图。直接提取旧 exe 图标确认了两者不一致，不能仅用 Windows 图标缓存解释。
- 当时的构建输出没有为 ICO 输出 `cargo:rerun-if-changed`，只监听配置等文件；增量构建可能复用旧的 `resource.lib`。以实际构建输出为依据，不用机器上其他 Cargo 缓存目录的依赖版本推断当前构建版本。
- `src-tauri/build.rs` 已显式监听 `icons/icon.ico`，确保换 ICO 时重编译 Windows 资源。窗口和托盘继续使用 Tauri 默认图标；桌面快捷方式取安装目录 exe 的图标。

## 本次替换与验证

- 用户先要求放大图案，随后明确反馈桌面图标不应有白色方底，并提供新的透明 PNG。当前 `src-tauri/app-icon-source.png` 使用这张透明图，保留完整图案及透明通道，裁去外围空白后生成 1024×1024 源图；图案仍约占画面 92%。标题栏的系统图标框大小不变。旧白底版本不再使用。
- `src-tauri/icons/` 共 52 个图标文件，已用当前透明源图全量重新生成。此前曾在空目录生成并对照相对路径集合与 SHA256，确认没有额外旧图标文件。
- `pnpm package:win --arch x64` 已生成安装包和便携包。通过 Windows 资源 API 读取 exe 的 RT_GROUP_ICON / RT_ICON，确认全部 6 个尺寸的原始数据逐一匹配新 ICO；便携包内 exe 的 SHA256 也与构建 exe 一致。
- `pnpm test:shell`：21 项通过。
- 图标透明度需单独检查；仅确认文件格式为 PNG / ICO 或图案正确，不能证明没有白底。当前 ICO 的 16、24、32、48、64、256 六个尺寸均已检查透明通道。
- 经用户授权，已安装到 `F:\soft\Tavlo` 并启动，安装后的 exe 全部 6 个图标帧也匹配新 ICO；从正在运行的窗口读取到放大后的新图标，并已通知 Windows Shell 刷新图标缓存。
- 已读取 Windows Shell 实际返回的桌面快捷方式图标，以及运行中窗口的图标，确认都保留透明背景。快捷方式左下角的系统箭头标记仍正常显示。

重新生成源文件不会自动更新已安装或正在运行的 Tavlo；要更新该实例，需要安装新包并重启。不要把生成成功或打包成功直接表述为已安装实例的图标已更新。

## 依据

- 项目构建接线：`src-tauri/build.rs`、`src-tauri/tauri.conf.json`、`src-tauri/src/lib.rs`。
- 旧 exe 与 `icon.ico` 的提取结果，以及 `target/.../build/tavlo-*/output` 中实际输出的构建依赖。
- [Tauri 官方图标文档](https://v2.tauri.app/develop/icons/)。
