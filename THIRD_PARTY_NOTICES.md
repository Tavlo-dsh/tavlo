# 第三方声明

除非另有说明，本仓库按 [MIT](LICENSE) 协议发布。

## rhythm1995/dsh-desktop（Apache-2.0）

本项目最初基于 [rhythm1995/dsh-desktop](https://github.com/rhythm1995/dsh-desktop) 改造。该项目以 Apache License 2.0 发布，全文见 [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)。

以下内容来自或修改自该项目，仍适用 Apache-2.0：

- `src-tauri/legacy/`（旧 Tauri 壳源码与本地页面，已标记为归档）
- `host/`、`vendor/`、`scripts/fetch-runtimes.*`、`scripts/runtimes.lock.json`、`scripts/sync-official-host.mjs`、`scripts/write-build-profile.mjs`、`scripts/tauri-prod-bundle.mjs`
- `src-tauri/icons/`

上述文件已被本项目修改。新写的壳代码（`src-tauri/src/`、`native-ui/`、`scripts/package-windows.mjs`）按 MIT 发布。
