<p align="center"><img src="https://raw.githubusercontent.com/${REPO}/${TAG}/src-tauri/icons/icon.png" width="96" alt="Tavlo logo" /></p>

## Tavlo ${VERSION}

Tavlo 是 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 的桌面壳：启动本机环境里的 `dsh web`，在独立窗口中展示，并提供托盘、单实例和启动失败提示。

Tavlo **不打包、不锁定 DSH 版本**，使用你本机安装的 `dsh`。升级 DSH 只需 `npm i -g @deepseek-ai/dsh@latest`，无需重新下载 Tavlo。

### 下载哪个

| 文件 | 适用 |
| --- | --- |
| `Tavlo_${VERSION}_x64-setup.exe` | Windows 安装版，Intel / AMD 电脑（大多数人选这个） |
| `Tavlo_${VERSION}_arm64-setup.exe` | Windows 安装版，Windows on ARM（骁龙等） |
| `Tavlo_${VERSION}_x64_portable.zip` | Windows 便携版，解压即用，数据写在同目录 `data\` |
| `Tavlo_${VERSION}_arm64_portable.zip` | Windows on ARM 便携版 |
| `Tavlo_${VERSION}_*.dmg` / `*.app.tar.gz` | macOS（未签名，首次打开需在「系统设置 → 隐私与安全性」中允许） |

校验值见 `SHA256SUMS.txt`。安装版装在当前用户下，不需要管理员权限；系统缺少 WebView2 时会自动下载。

### 运行前提

1. Node.js ≥ 24.9
2. 已安装 DSH：`npm i -g @deepseek-ai/dsh`，或设置环境变量 `DSH_BIN` 指向 `dsh` / `dsh.cmd` / `bin.js`
3. Microsoft Edge WebView2 Runtime（Windows 10/11 通常自带）

### 遇到问题

- 启动日志：`%LOCALAPPDATA%\com.tavlo.desktop\logs\dsh-web.log`（便携版在 `data\logs\`，token 已脱敏）
- 托盘菜单可以「重启 DSH」或「打开日志」
- DSH 的配置与会话仍在 `~/.dsh`，与命令行 `dsh web` 共享
