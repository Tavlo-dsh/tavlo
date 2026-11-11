import { describe, expect, it } from 'vitest'
import {
  desktopDiagnosticsPrivacyCopy,
  desktopLocaleFromLanguageTag,
  desktopNativeCopy,
  desktopRestartConfirmationCopy,
  desktopTrayLabel,
  volumeAdmissionCopy,
} from '../src/runtime/dialog-copy.ts'

describe('desktopNativeCopy', () => {
  it('matches the original terminal launch error copy', () => {
    expect(desktopNativeCopy('en').terminalErrorTitle).toBe('Unable to Open DSH Terminal')
    expect(desktopNativeCopy('en').terminalErrorMessage).toBe('DSH Desktop could not open a terminal.')
    expect(desktopNativeCopy('en').ok).toBe('OK')
    expect(desktopNativeCopy('zh').terminalErrorTitle).toBe('无法打开 DSH 终端')
    expect(desktopNativeCopy('zh').terminalErrorMessage).toBe('DSH Desktop 无法打开终端。')
    expect(desktopNativeCopy('zh').ok).toBe('确定')
  })

  it('matches the original plugin recovery copy', () => {
    const en = desktopNativeCopy('en')
    expect(en.pluginRecoveryTitle).toBe('Plugin Load Failed')
    expect(en.pluginRecoveryMessage).toBe('Some plugins could not be loaded.')
    expect(en.unknownPlugin).toBe('Unknown client plugin')
    expect(en.missingPluginError).toBe('The plugin loader did not provide an error message.')
    expect(en.failedPlugins).toBe('Plugins that failed to load:')
    expect(en.pluginRecoveryInstructions).toBe(
      'Open DSH Terminal to update or remove the failing third-party plugin, then restart DSH Desktop.',
    )
    expect(en.openTerminal).toBe('Open DSH Terminal')
    expect(en.restart).toBe('Restart DSH Desktop')
    expect(en.dismiss).toBe('Dismiss')
    const zh = desktopNativeCopy('zh')
    expect(zh.pluginRecoveryTitle).toBe('插件加载失败')
    expect(zh.pluginRecoveryMessage).toBe('部分插件未能加载。')
    expect(zh.unknownPlugin).toBe('未知客户端插件')
    expect(zh.missingPluginError).toBe('插件加载器没有提供错误信息。')
    expect(zh.failedPlugins).toBe('加载失败的插件：')
    expect(zh.pluginRecoveryInstructions).toBe('请打开 DSH 终端更新或移除失败的第三方插件，然后重启 DSH Desktop。')
    expect(zh.openTerminal).toBe('打开 DSH 终端')
    expect(zh.restart).toBe('重启 DSH Desktop')
    expect(zh.dismiss).toBe('关闭')
  })

  it('matches the original diagnostics error copy', () => {
    expect(desktopNativeCopy('en').diagnosticsErrorTitle).toBe('Unable to Export Diagnostics')
    expect(desktopNativeCopy('en').diagnosticsErrorMessage).toBe('DSH Desktop could not export the diagnostic archive.')
    expect(desktopNativeCopy('zh').diagnosticsErrorTitle).toBe('无法导出诊断信息')
    expect(desktopNativeCopy('zh').diagnosticsErrorMessage).toBe('DSH Desktop 无法导出诊断包。')
  })

  it('matches the original update copy', () => {
    const en = desktopNativeCopy('en')
    expect(en.updateAvailableTitle).toBe('DSH Desktop Update Available')
    expect(en.updateAvailableMessage('1.2.0')).toBe('DSH Desktop 1.2.0 is available.')
    expect(en.downloadUpdate).toBe('Download this update now?')
    expect(en.download).toBe('Download')
    expect(en.later).toBe('Later')
    expect(en.updateCheckFailedTitle).toBe('Unable to Check for Updates')
    expect(en.updateCheckFailedMessage).toBe('DSH Desktop could not check for updates.')
    expect(en.tryAgainLater).toBe('Please try again later.')
    expect(en.upToDateTitle).toBe('DSH Desktop Is Up to Date')
    expect(en.upToDateMessage).toBe('No newer version of DSH Desktop is available.')
    expect(en.installedVersion('0.1.0')).toBe('Installed version: 0.1.0')
    expect(en.installerUnavailable).toBe('Installer downloads are unavailable in this build.')
    expect(en.updateDownloadedTitle).toBe('DSH Desktop Update Downloaded')
    expect(en.macInstallInstructions).toBe(
      'The disk image has opened. Replace DSH Desktop in Applications, then reopen it.',
    )
    expect(en.windowsInstallQuestion).toBe('Restart DSH Desktop and run the installer now?')
    expect(en.restartAndInstall).toBe('Restart and Install')
    expect(en.saveInstallerTitle).toBe('Save Update Installer')
    expect(en.saveAndDownload).toBe('Save and Download')
    expect(en.diskImage).toBe('Disk Image')
    expect(en.windowsInstaller).toBe('Windows Installer')
    expect(en.removeInstallerTitle).toBe('Remove Update Installer')
    expect(en.deleteInstaller).toBe('Delete Installer')
    expect(en.keepInstaller).toBe('Keep Installer')
    const zh = desktopNativeCopy('zh')
    expect(zh.updateAvailableTitle).toBe('DSH Desktop 有可用更新')
    expect(zh.updateAvailableMessage('1.2.0')).toBe('DSH Desktop 1.2.0 已可用。')
    expect(zh.downloadUpdate).toBe('现在下载此更新？')
    expect(zh.download).toBe('下载')
    expect(zh.later).toBe('稍后')
    expect(zh.updateCheckFailedTitle).toBe('无法检查更新')
    expect(zh.tryAgainLater).toBe('请稍后重试。')
    expect(zh.upToDateTitle).toBe('DSH Desktop 已是最新版本')
    expect(zh.installedVersion('0.1.0')).toBe('当前版本：0.1.0')
    expect(zh.installerUnavailable).toBe('此构建不支持下载安装包。')
    expect(zh.updateDownloadedTitle).toBe('DSH Desktop 更新已下载')
    expect(zh.macInstallInstructions).toBe('磁盘映像已打开。请替换“应用程序”中的 DSH Desktop，然后重新打开。')
    expect(zh.windowsInstallQuestion).toBe('现在重启 DSH Desktop 并运行安装程序？')
    expect(zh.restartAndInstall).toBe('重启并安装')
    expect(zh.saveInstallerTitle).toBe('保存更新安装包')
    expect(zh.saveAndDownload).toBe('保存并下载')
    expect(zh.deleteInstaller).toBe('删除安装包')
    expect(zh.keepInstaller).toBe('保留安装包')
  })
})

describe('desktopRestartConfirmationCopy', () => {
  it('matches the original normal restart copy', () => {
    const en = desktopRestartConfirmationCopy('en', 'normal')
    expect(en).toEqual({
      title: 'Restart DSH Desktop',
      message: 'Restart DSH Desktop now?',
      detail: 'Running operations and unsent input may be interrupted. Saved settings will not be lost.',
      confirm: 'Restart',
      cancel: 'Cancel',
    })
    const zh = desktopRestartConfirmationCopy('zh', 'normal')
    expect(zh).toEqual({
      title: '重启 DSH Desktop',
      message: '现在重启 DSH Desktop？',
      detail: '正在运行的操作和未发送的输入可能会中断，已保存的设置不会丢失。',
      confirm: '重启',
      cancel: '取消',
    })
  })

  it('matches the original recovery restart copy', () => {
    const en = desktopRestartConfirmationCopy('en', 'recovery')
    expect(en).toEqual({
      title: 'Restart in Recovery Mode',
      message: 'Restart DSH Desktop in Recovery Mode?',
      detail: 'The next launch opens the recovery assistant before the Profile and plugin Host start. Running operations and unsent input may be interrupted.',
      confirm: 'Restart in Recovery Mode',
      cancel: 'Cancel',
    })
    const zh = desktopRestartConfirmationCopy('zh', 'recovery')
    expect(zh).toEqual({
      title: '重启到恢复模式',
      message: '重启 DSH Desktop 并进入恢复模式？',
      detail: '下次启动会在 Profile 和插件 Host 运行前打开恢复助手。正在运行的操作和未发送的输入可能会中断。',
      confirm: '重启到恢复模式',
      cancel: '取消',
    })
  })
})

describe('desktopDiagnosticsPrivacyCopy', () => {
  it('matches the original privacy confirmation copy', () => {
    const en = desktopDiagnosticsPrivacyCopy('en')
    expect(en.title).toBe('Export Diagnostics')
    expect(en.message).toBe('Review the diagnostic archive before sharing it.')
    expect(en.detail).toBe(
      'The archive contains recent application logs, local crash dumps, and system information. Logs may contain local paths, workspace IDs, and session IDs. Crash dumps may contain fragments of process memory. Authentication credentials are masked in logs when recognized, but you should still review the archive before uploading it publicly.',
    )
    expect(en.confirm).toBe('Export')
    expect(en.cancel).toBe('Cancel')
    const zh = desktopDiagnosticsPrivacyCopy('zh')
    expect(zh.title).toBe('导出诊断信息')
    expect(zh.message).toBe('分享诊断包前请先检查其中的内容。')
    expect(zh.detail).toBe(
      '诊断包包含最近的应用日志、本地崩溃转储和系统信息。日志可能包含本地路径、工作区 ID 和会话 ID，崩溃转储可能包含进程内存片段。系统会对日志中可识别的认证凭据进行脱敏，但公开上传前仍应检查诊断包。',
    )
    expect(zh.confirm).toBe('导出')
    expect(zh.cancel).toBe('取消')
  })
})

describe('desktopTrayLabel', () => {
  it('matches the original tray label table', () => {
    expect(desktopTrayLabel('en', 'openDesktop', 'DSH Desktop')).toBe('Open DSH Desktop')
    expect(desktopTrayLabel('zh', 'openDesktop', 'DSH Desktop')).toBe('打开 DSH Desktop')
    expect(desktopTrayLabel('en', 'quit')).toBe('Quit')
    expect(desktopTrayLabel('zh', 'quit')).toBe('退出')
    expect(desktopTrayLabel('en', 'openTerminal')).toBe('Open DSH Terminal')
    expect(desktopTrayLabel('zh', 'openTerminal')).toBe('打开 DSH 终端')
    expect(desktopTrayLabel('en', 'switchToExtended')).toBe('Switch to Extended Window')
    expect(desktopTrayLabel('zh', 'switchToExtended')).toBe('切换到扩展窗口')
    expect(desktopTrayLabel('en', 'switchToAdvanced')).toBe('Switch to Enhanced Mode')
    expect(desktopTrayLabel('zh', 'switchToAdvanced')).toBe('切换到增强模式')
    expect(desktopTrayLabel('en', 'switchToCompatibility')).toBe('Switch to Compatibility Mode')
    expect(desktopTrayLabel('zh', 'switchToCompatibility')).toBe('切换到兼容模式')
    expect(desktopTrayLabel('en', 'profile', 'desktop')).toBe('Profile: desktop')
    expect(desktopTrayLabel('zh', 'profile', 'desktop')).toBe('Profile：desktop')
    expect(desktopTrayLabel('en', 'addProfile')).toBe('New Profile…')
    expect(desktopTrayLabel('zh', 'addProfile')).toBe('新建 Profile…')
    expect(desktopTrayLabel('en', 'unavailableForDesktop', 'web')).toBe('web (Unavailable for Desktop)')
    expect(desktopTrayLabel('zh', 'unavailableForDesktop', 'web')).toBe('web（不可用于桌面端）')
    expect(desktopTrayLabel('en', 'checkForUpdates')).toBe('Check for Updates…')
    expect(desktopTrayLabel('zh', 'checkForUpdates')).toBe('检查更新…')
    expect(desktopTrayLabel('en', 'checkingForUpdates')).toBe('Checking for Updates…')
    expect(desktopTrayLabel('zh', 'checkingForUpdates')).toBe('正在检查更新…')
    expect(desktopTrayLabel('en', 'downloadingUpdate', '1.2.0')).toBe('Downloading DSH Desktop 1.2.0…')
    expect(desktopTrayLabel('zh', 'downloadingUpdate', '1.2.0')).toBe('正在下载 DSH Desktop 1.2.0…')
    expect(desktopTrayLabel('en', 'updateAvailable', '1.2.0')).toBe('DSH Desktop 1.2.0 Available')
    expect(desktopTrayLabel('zh', 'updateAvailable', '1.2.0')).toBe('DSH Desktop 1.2.0 可用')
    expect(desktopTrayLabel('en', 'exportDiagnostics')).toBe('Export Diagnostics…')
    expect(desktopTrayLabel('zh', 'exportDiagnostics')).toBe('导出诊断信息…')
  })
})

describe('desktopLocaleFromLanguageTag', () => {
  it('resolves zh only for chinese tags', () => {
    expect(desktopLocaleFromLanguageTag('zh')).toBe('zh')
    expect(desktopLocaleFromLanguageTag('zh-CN')).toBe('zh')
    expect(desktopLocaleFromLanguageTag('zh_Hans')).toBe('zh')
    expect(desktopLocaleFromLanguageTag('en-US')).toBe('en')
    expect(desktopLocaleFromLanguageTag('ja')).toBe('en')
  })
})

describe('volumeAdmissionCopy', () => {
  it('matches the original confirm and block copy', () => {
    const confirmEn = volumeAdmissionCopy('en').confirm('/mnt/drive')
    expect(confirmEn.title).toBe('Removable Workspace')
    expect(confirmEn.message).toBe('This workspace is on a removable NTFS/ReFS drive.')
    expect(confirmEn.detail).toBe(
      'Disconnecting the drive while DSH Desktop is running can break commands or plugin operations. Keep it connected.\n\n/mnt/drive',
    )
    expect(confirmEn.buttons).toEqual(['Use This Folder', 'Choose Another Folder'])
    const confirmZh = volumeAdmissionCopy('zh').confirm('/mnt/drive')
    expect(confirmZh.title).toBe('外接工作区')
    expect(confirmZh.message).toBe('这个工作区位于可移除的 NTFS/ReFS 磁盘上。')
    expect(confirmZh.detail).toBe('使用过程中拔出磁盘会导致命令或插件操作失败。请保持磁盘连接。\n\n/mnt/drive')
    expect(confirmZh.buttons).toEqual(['使用此文件夹', '选择其他文件夹'])
    const blockEn = volumeAdmissionCopy('en').block('exFAT', '/mnt/usb')
    expect(blockEn.title).toBe('Unsupported Workspace Storage')
    expect(blockEn.message).toBe('exFAT cannot safely host a DSH Desktop workspace.')
    expect(blockEn.detail).toBe(
      'Choose a folder on a local NTFS or ReFS volume. exFAT, FAT32, network drives, and uninspectable volumes are not persisted as workspaces.\n\n/mnt/usb',
    )
    expect(blockEn.buttons).toEqual(['Choose Another Folder'])
    const blockZh = volumeAdmissionCopy('zh').block('exFAT', '/mnt/usb')
    expect(blockZh.title).toBe('不支持的工作区存储')
    expect(blockZh.message).toBe('exFAT 不能安全用作 DSH Desktop 工作区。')
    expect(blockZh.detail).toBe('请选择本地 NTFS 或 ReFS 磁盘上的文件夹。exFAT、FAT32、网络盘和无法检测的磁盘不会被保存为工作区。\n\n/mnt/usb')
    expect(blockZh.buttons).toEqual(['选择其他文件夹'])
  })

  it('matches the original picker title', () => {
    expect(volumeAdmissionCopy('en').pickerTitle).toBe('Select Workspace Directory')
    expect(volumeAdmissionCopy('zh').pickerTitle).toBe('选择工作区目录')
  })
})
