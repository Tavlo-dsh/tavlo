/** Localized copy for Desktop-owned native dialogs, tray labels, and notifications.
 *
 * Ported verbatim from the upstream Electron shell (`native-dialog-copy.ts`,
 * `tray-locale.ts`, and the workspace admission dialogs) so the Tauri shell
 * renders the same product copy. */

import type { DesktopLocale } from './types.ts'

export interface DesktopNativeCopy {
  readonly ok: string
  readonly pluginRecoveryTitle: string
  readonly pluginRecoveryMessage: string
  readonly unknownPlugin: string
  readonly missingPluginError: string
  readonly failedPlugins: string
  readonly pluginRecoveryInstructions: string
  readonly openTerminal: string
  readonly restart: string
  readonly dismiss: string
  readonly updateAvailableTitle: string
  readonly updateAvailableMessage: (version: string) => string
  readonly downloadUpdate: string
  readonly download: string
  readonly later: string
  readonly updateCheckFailedTitle: string
  readonly updateCheckFailedMessage: string
  readonly tryAgainLater: string
  readonly upToDateTitle: string
  readonly upToDateMessage: string
  readonly installedVersion: (version: string) => string
  readonly installerUnavailable: string
  readonly updateDownloadedTitle: string
  readonly updateReady: (version: string) => string
  readonly macInstallInstructions: string
  readonly windowsInstallQuestion: string
  readonly restartAndInstall: string
  readonly saveInstallerTitle: string
  readonly saveAndDownload: string
  readonly diskImage: string
  readonly windowsInstaller: string
  readonly removeInstallerTitle: string
  readonly updateInstalled: (version: string) => string
  readonly removeInstallerQuestion: (path: string) => string
  readonly deleteInstaller: string
  readonly keepInstaller: string
  readonly terminalErrorTitle: string
  readonly terminalErrorMessage: string
  readonly diagnosticsErrorTitle: string
  readonly diagnosticsErrorMessage: string
  readonly unsupportedStorageTitle: string
  readonly unsupportedStorageBody: (label: string) => string
}

const COPY: Record<DesktopLocale, DesktopNativeCopy> = {
  en: {
    ok: 'OK',
    pluginRecoveryTitle: 'Plugin Load Failed',
    pluginRecoveryMessage: 'Some plugins could not be loaded.',
    unknownPlugin: 'Unknown client plugin',
    missingPluginError: 'The plugin loader did not provide an error message.',
    failedPlugins: 'Plugins that failed to load:',
    pluginRecoveryInstructions: 'Open DSH Terminal to update or remove the failing third-party plugin, then restart DSH Desktop.',
    openTerminal: 'Open DSH Terminal',
    restart: 'Restart DSH Desktop',
    dismiss: 'Dismiss',
    updateAvailableTitle: 'DSH Desktop Update Available',
    updateAvailableMessage: version => `DSH Desktop ${version} is available.`,
    downloadUpdate: 'Download this update now?',
    download: 'Download',
    later: 'Later',
    updateCheckFailedTitle: 'Unable to Check for Updates',
    updateCheckFailedMessage: 'DSH Desktop could not check for updates.',
    tryAgainLater: 'Please try again later.',
    upToDateTitle: 'DSH Desktop Is Up to Date',
    upToDateMessage: 'No newer version of DSH Desktop is available.',
    installedVersion: version => `Installed version: ${version}`,
    installerUnavailable: 'Installer downloads are unavailable in this build.',
    updateDownloadedTitle: 'DSH Desktop Update Downloaded',
    updateReady: version => `DSH Desktop ${version} is ready to install.`,
    macInstallInstructions: 'The disk image has opened. Replace DSH Desktop in Applications, then reopen it.',
    windowsInstallQuestion: 'Restart DSH Desktop and run the installer now?',
    restartAndInstall: 'Restart and Install',
    saveInstallerTitle: 'Save Update Installer',
    saveAndDownload: 'Save and Download',
    diskImage: 'Disk Image',
    windowsInstaller: 'Windows Installer',
    removeInstallerTitle: 'Remove Update Installer',
    updateInstalled: version => `DSH Desktop ${version} has been installed.`,
    removeInstallerQuestion: path => `Delete the downloaded installer to free disk space?\n\n${path}`,
    deleteInstaller: 'Delete Installer',
    keepInstaller: 'Keep Installer',
    terminalErrorTitle: 'Unable to Open DSH Terminal',
    terminalErrorMessage: 'DSH Desktop could not open a terminal.',
    diagnosticsErrorTitle: 'Unable to Export Diagnostics',
    diagnosticsErrorMessage: 'DSH Desktop could not export the diagnostic archive.',
    unsupportedStorageTitle: 'Storage May Be Unsupported',
    unsupportedStorageBody: label => `${label} is on a volume that may prevent sandboxed commands or plugin installation from working.`,
  },
  zh: {
    ok: '确定',
    pluginRecoveryTitle: '插件加载失败',
    pluginRecoveryMessage: '部分插件未能加载。',
    unknownPlugin: '未知客户端插件',
    missingPluginError: '插件加载器没有提供错误信息。',
    failedPlugins: '加载失败的插件：',
    pluginRecoveryInstructions: '请打开 DSH 终端更新或移除失败的第三方插件，然后重启 DSH Desktop。',
    openTerminal: '打开 DSH 终端',
    restart: '重启 DSH Desktop',
    dismiss: '关闭',
    updateAvailableTitle: 'DSH Desktop 有可用更新',
    updateAvailableMessage: version => `DSH Desktop ${version} 已可用。`,
    downloadUpdate: '现在下载此更新？',
    download: '下载',
    later: '稍后',
    updateCheckFailedTitle: '无法检查更新',
    updateCheckFailedMessage: 'DSH Desktop 无法检查更新。',
    tryAgainLater: '请稍后重试。',
    upToDateTitle: 'DSH Desktop 已是最新版本',
    upToDateMessage: '当前没有更新版本的 DSH Desktop。',
    installedVersion: version => `当前版本：${version}`,
    installerUnavailable: '此构建不支持下载安装包。',
    updateDownloadedTitle: 'DSH Desktop 更新已下载',
    updateReady: version => `DSH Desktop ${version} 已可安装。`,
    macInstallInstructions: '磁盘映像已打开。请替换“应用程序”中的 DSH Desktop，然后重新打开。',
    windowsInstallQuestion: '现在重启 DSH Desktop 并运行安装程序？',
    restartAndInstall: '重启并安装',
    saveInstallerTitle: '保存更新安装包',
    saveAndDownload: '保存并下载',
    diskImage: '磁盘映像',
    windowsInstaller: 'Windows 安装程序',
    removeInstallerTitle: '删除更新安装包',
    updateInstalled: version => `DSH Desktop ${version} 已安装。`,
    removeInstallerQuestion: path => `是否删除下载的安装包以释放磁盘空间？\n\n${path}`,
    deleteInstaller: '删除安装包',
    keepInstaller: '保留安装包',
    terminalErrorTitle: '无法打开 DSH 终端',
    terminalErrorMessage: 'DSH Desktop 无法打开终端。',
    diagnosticsErrorTitle: '无法导出诊断信息',
    diagnosticsErrorMessage: 'DSH Desktop 无法导出诊断包。',
    unsupportedStorageTitle: '存储位置可能不受支持',
    unsupportedStorageBody: label => `${label} 所在的磁盘可能导致沙盒命令或插件安装无法正常工作。`,
  },
}

export function desktopNativeCopy(locale: DesktopLocale): DesktopNativeCopy {
  return COPY[locale]
}

export type DesktopTrayLabelKey =
  | 'addProfile'
  | 'checkForUpdates'
  | 'checkingForUpdates'
  | 'downloadingUpdate'
  | 'exportDiagnostics'
  | 'openDesktop'
  | 'openTerminal'
  | 'profile'
  | 'quit'
  | 'switchToAdvanced'
  | 'switchToCompatibility'
  | 'switchToExtended'
  | 'unavailableForDesktop'
  | 'updateAvailable'

const TRAY_LABELS: Record<DesktopLocale, Record<DesktopTrayLabelKey, (value: string) => string>> = {
  en: {
    addProfile: () => 'New Profile…',
    checkForUpdates: () => 'Check for Updates…',
    checkingForUpdates: () => 'Checking for Updates…',
    downloadingUpdate: version => `Downloading DSH Desktop ${version}…`,
    exportDiagnostics: () => 'Export Diagnostics…',
    openDesktop: productName => `Open ${productName}`,
    openTerminal: () => 'Open DSH Terminal',
    profile: profileName => `Profile: ${profileName}`,
    quit: () => 'Quit',
    switchToAdvanced: () => 'Switch to Enhanced Mode',
    switchToCompatibility: () => 'Switch to Compatibility Mode',
    switchToExtended: () => 'Switch to Extended Window',
    unavailableForDesktop: profileName => `${profileName} (Unavailable for Desktop)`,
    updateAvailable: version => `DSH Desktop ${version} Available`,
  },
  zh: {
    addProfile: () => '新建 Profile…',
    checkForUpdates: () => '检查更新…',
    checkingForUpdates: () => '正在检查更新…',
    downloadingUpdate: version => `正在下载 DSH Desktop ${version}…`,
    exportDiagnostics: () => '导出诊断信息…',
    openDesktop: productName => `打开 ${productName}`,
    openTerminal: () => '打开 DSH 终端',
    profile: profileName => `Profile：${profileName}`,
    quit: () => '退出',
    switchToAdvanced: () => '切换到增强模式',
    switchToCompatibility: () => '切换到兼容模式',
    switchToExtended: () => '切换到扩展窗口',
    unavailableForDesktop: profileName => `${profileName}（不可用于桌面端）`,
    updateAvailable: version => `DSH Desktop ${version} 可用`,
  },
}

export function desktopTrayLabel(locale: DesktopLocale, key: DesktopTrayLabelKey, value = ''): string {
  return TRAY_LABELS[locale][key](value)
}

export interface DesktopDiagnosticsPrivacyCopy {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
}

export interface DesktopRestartConfirmationCopy {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
}

const RESTART_CONFIRMATION: Record<DesktopLocale, Record<'normal' | 'recovery', DesktopRestartConfirmationCopy>> = {
  en: {
    normal: {
      title: 'Restart DSH Desktop',
      message: 'Restart DSH Desktop now?',
      detail: 'Running operations and unsent input may be interrupted. Saved settings will not be lost.',
      confirm: 'Restart',
      cancel: 'Cancel',
    },
    recovery: {
      title: 'Restart in Recovery Mode',
      message: 'Restart DSH Desktop in Recovery Mode?',
      detail: 'The next launch opens the recovery assistant before the Profile and plugin Host start. Running operations and unsent input may be interrupted.',
      confirm: 'Restart in Recovery Mode',
      cancel: 'Cancel',
    },
  },
  zh: {
    normal: {
      title: '重启 DSH Desktop',
      message: '现在重启 DSH Desktop？',
      detail: '正在运行的操作和未发送的输入可能会中断，已保存的设置不会丢失。',
      confirm: '重启',
      cancel: '取消',
    },
    recovery: {
      title: '重启到恢复模式',
      message: '重启 DSH Desktop 并进入恢复模式？',
      detail: '下次启动会在 Profile 和插件 Host 运行前打开恢复助手。正在运行的操作和未发送的输入可能会中断。',
      confirm: '重启到恢复模式',
      cancel: '取消',
    },
  },
}

const DIAGNOSTICS_PRIVACY: Record<DesktopLocale, DesktopDiagnosticsPrivacyCopy> = {
  en: {
    title: 'Export Diagnostics',
    message: 'Review the diagnostic archive before sharing it.',
    detail: 'The archive contains recent application logs, local crash dumps, and system information. Logs may contain local paths, workspace IDs, and session IDs. Crash dumps may contain fragments of process memory. Authentication credentials are masked in logs when recognized, but you should still review the archive before uploading it publicly.',
    confirm: 'Export',
    cancel: 'Cancel',
  },
  zh: {
    title: '导出诊断信息',
    message: '分享诊断包前请先检查其中的内容。',
    detail: '诊断包包含最近的应用日志、本地崩溃转储和系统信息。日志可能包含本地路径、工作区 ID 和会话 ID，崩溃转储可能包含进程内存片段。系统会对日志中可识别的认证凭据进行脱敏，但公开上传前仍应检查诊断包。',
    confirm: '导出',
    cancel: '取消',
  },
}

export function desktopDiagnosticsPrivacyCopy(locale: DesktopLocale): DesktopDiagnosticsPrivacyCopy {
  return DIAGNOSTICS_PRIVACY[locale]
}

export function desktopRestartConfirmationCopy(
  locale: DesktopLocale,
  target: 'normal' | 'recovery' = 'normal',
): DesktopRestartConfirmationCopy {
  return RESTART_CONFIRMATION[locale][target]
}

/** Resolve DSH's zh/en locale from an OS or browser language tag. */
export function desktopLocaleFromLanguageTag(languageTag: string): DesktopLocale {
  return /^zh(?:[-_]|$)/iu.test(languageTag) ? 'zh' : 'en'
}

export interface VolumeAdmissionDialogCopy {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly buttons: readonly string[]
  readonly defaultId: number
  readonly cancelId: number
}

export interface VolumeAdmissionCopy {
  readonly pickerTitle: string
  readonly confirm: (path: string) => VolumeAdmissionDialogCopy
  readonly block: (fileSystem: string, path: string) => VolumeAdmissionDialogCopy
}

const VOLUME_ADMISSION: Record<DesktopLocale, VolumeAdmissionCopy> = {
  en: {
    pickerTitle: 'Select Workspace Directory',
    confirm: path => ({
      title: 'Removable Workspace',
      message: 'This workspace is on a removable NTFS/ReFS drive.',
      detail: `Disconnecting the drive while DSH Desktop is running can break commands or plugin operations. Keep it connected.\n\n${path}`,
      buttons: ['Use This Folder', 'Choose Another Folder'],
      defaultId: 1,
      cancelId: 1,
    }),
    block: (fileSystem, path) => ({
      title: 'Unsupported Workspace Storage',
      message: `${fileSystem} cannot safely host a DSH Desktop workspace.`,
      detail: `Choose a folder on a local NTFS or ReFS volume. exFAT, FAT32, network drives, and uninspectable volumes are not persisted as workspaces.\n\n${path}`,
      buttons: ['Choose Another Folder'],
      defaultId: 0,
      cancelId: 0,
    }),
  },
  zh: {
    pickerTitle: '选择工作区目录',
    confirm: path => ({
      title: '外接工作区',
      message: '这个工作区位于可移除的 NTFS/ReFS 磁盘上。',
      detail: `使用过程中拔出磁盘会导致命令或插件操作失败。请保持磁盘连接。\n\n${path}`,
      buttons: ['使用此文件夹', '选择其他文件夹'],
      defaultId: 1,
      cancelId: 1,
    }),
    block: (fileSystem, path) => ({
      title: '不支持的工作区存储',
      message: `${fileSystem} 不能安全用作 DSH Desktop 工作区。`,
      detail: `请选择本地 NTFS 或 ReFS 磁盘上的文件夹。exFAT、FAT32、网络盘和无法检测的磁盘不会被保存为工作区。\n\n${path}`,
      buttons: ['选择其他文件夹'],
      defaultId: 0,
      cancelId: 0,
    }),
  },
}

export function volumeAdmissionCopy(locale: DesktopLocale): VolumeAdmissionCopy {
  return VOLUME_ADMISSION[locale]
}
