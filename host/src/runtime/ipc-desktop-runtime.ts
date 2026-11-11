import { NATIVE_EVENTS, NATIVE_METHODS } from '../rpc/protocol.ts'
import type { RpcTransport } from '../rpc/transport.ts'
import type {
  DesktopDialogOptions,
  DesktopDialogResult,
  DesktopLocale,
  DesktopNotification,
  DesktopPlatform,
  DesktopShellMode,
  DesktopShellPayload,
  DesktopShellSpec,
  DesktopTerminalSpec,
  DesktopThemeSource,
  DesktopTrayItemGroup,
  DesktopTrayItemSnapshot,
  DesktopTraySubmenuSnapshot,
  ProfileCreateWindowOptions,
  RendererBootReport,
} from './types.ts'
import { DesktopRendererHealthGate, type RendererHealthFailureReason, type RendererHealthVerdict } from './renderer-health.ts'
import {
  desktopDiagnosticsPrivacyCopy,
  desktopLocaleFromLanguageTag,
  desktopNativeCopy,
  desktopRestartConfirmationCopy,
  desktopTrayLabel,
  volumeAdmissionCopy,
} from './dialog-copy.ts'
import {
  desktopTerminalStateDirectory,
  prepareDesktopTerminal,
} from './desktop-terminal.ts'
import { downloadDesktopUpdate } from './update-download.ts'

export interface DesktopTerminalRuntime {
  readonly nodeExecutable: string
  readonly dshBootstrapPath: string
  readonly pnpmBinPath: string
  readonly nodeVersion: string
  readonly productVersion: string
}

export interface DesktopTraySubmenuItem {
  label(): string
  type?: 'normal' | 'checkbox' | 'radio'
  enabled?(): boolean
  checked?(): boolean
  invoke(): void | Promise<void>
}

export interface DesktopTrayItem {
  group: DesktopTrayItemGroup
  order: number
  label(): string
  enabled?(): boolean
  invoke(): void | Promise<void>
  submenu?(): readonly DesktopTraySubmenuItem[]
}

export interface DesktopTrayItemRegistration {
  refresh(): void
  dispose(): void
}

export interface DesktopUpdateAdapter {
  readonly isPackaged: boolean
  readonly canDownload: boolean
  readonly currentVersion: string
  readonly statePath: string
  readonly request: (url: string, init: RequestInit) => Promise<Response>
  confirmDownload(version: string): Promise<boolean>
  showManualCheckResult(result: { status: string, currentVersion: string, latestVersion?: string } | null): Promise<void>
  downloadAndOpen(version: string, signal: AbortSignal): Promise<void>
  notify(notification: DesktopNotification): void
}

export interface DesktopRuntime {
  readonly platform: DesktopPlatform
  readonly windowsBuild: number | undefined
  readonly locale: DesktopLocale
  readonly updates: DesktopUpdateAdapter
  schedule(spec: DesktopShellPayload | DesktopShellSpec): () => Promise<void>
  mountScheduled(beforeInteractive?: () => void): Promise<void>
  show(): void
  notifyAttention(notification: DesktopNotification): void
  registerTrayItem(item: DesktopTrayItem): DesktopTrayItemRegistration
  openTerminal(): void
  reloadRenderer(): void
  toggleDeveloperTools(): void
  exportDiagnostics(): Promise<void>
  pickDirectory(): Promise<string | null>
  validateDirectory(path: string): Promise<boolean>
  openProfileCreateWindow(options: ProfileCreateWindowOptions): void
  reportRendererBoot(report: RendererBootReport): void
  setLocalePreference(preference: DesktopLocale | undefined): void
  setThemeSource(source: DesktopThemeSource): void
  requestRestart(): Promise<void>
  requestRecoveryRestart(): Promise<void>
  prepareToQuit(): void
  openDialog(options: DesktopDialogOptions): Promise<DesktopDialogResult>
  openRecovery(state: unknown): Promise<void>
  openProfileCreate(state: unknown): void
  openDevtools(options: { tab: 'logs' | 'network', origin: string }): void
  configureTerminal(spec: DesktopTerminalSpec): void
  setTerminalRuntime?(runtime: DesktopTerminalRuntime): void
  beginRendererBootMonitoring(
    options: { commitHealthy: () => Promise<void> },
    timeoutMs?: number,
  ): Promise<RendererHealthVerdict>
  stopRendererBootMonitoring(): void
  readonly rendererBootFailureReason: RendererHealthFailureReason | undefined
}

interface RegisteredTray {
  readonly id: string
  readonly item: DesktopTrayItem
  readonly submenu: DesktopTraySubmenuItem[]
}

function defaultSystemLocaleTag(): string {
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
    const value = process.env[key]
    if (value !== undefined && value.length > 0) return value
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return 'en'
  }
}

export class IpcDesktopRuntime implements DesktopRuntime {
  readonly platform: DesktopPlatform
  readonly windowsBuild: number | undefined
  readonly updates: DesktopUpdateAdapter
  locale: DesktopLocale = 'en'
  private scheduled: DesktopShellPayload | undefined
  private scheduledSpec: DesktopShellSpec | undefined
  private mountTask: Promise<void> | undefined
  private generationId: string | undefined
  private terminalSpec: DesktopTerminalSpec | undefined
  private terminalRuntime: DesktopTerminalRuntime | undefined
  private readonly userDataDir: string
  private readonly tray = new Map<string, RegisteredTray>()
  private traySeq = 1
  private readonly unsubscribers: Array<() => void> = []
  private rendererHealthGate: DesktopRendererHealthGate | undefined
  private rendererBootDialogTask: Promise<void> | undefined
  private restartRequest: Promise<void> | undefined
  private diagnosticExport: Promise<void> | undefined
  private quitting = false
  private profileCreate?: ProfileCreateWindowOptions
  private readonly systemLocaleTag: () => string
  private readonly updatesRequest: (url: string, init: RequestInit) => Promise<Response>

  constructor(
    private readonly transport: RpcTransport,
    options: {
      platform: DesktopPlatform
      windowsBuild?: number
      locale?: DesktopLocale
      userDataDir?: string
      isPackaged?: boolean
      currentVersion?: string
      terminalRuntime?: DesktopTerminalRuntime
      systemLocaleTag?: () => string
      updatesRequest?: (url: string, init: RequestInit) => Promise<Response>
    } = {
      platform: process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux'
        ? process.platform
        : 'linux',
    },
  ) {
    this.platform = options.platform
    this.windowsBuild = options.windowsBuild
    if (options.locale !== undefined) this.locale = options.locale
    this.terminalRuntime = options.terminalRuntime
    const userDataDir = options.userDataDir ?? ''
    this.userDataDir = userDataDir
    const currentVersion = options.currentVersion ?? '0.1.0'
    const isPackaged = options.isPackaged ?? false
    this.systemLocaleTag = options.systemLocaleTag ?? defaultSystemLocaleTag
    this.updatesRequest = options.updatesRequest ?? ((url, init) => fetch(url, init))
    this.updates = {
      isPackaged,
      canDownload: this.platform === 'darwin' || this.platform === 'win32',
      currentVersion,
      statePath: `${userDataDir}/updates/state.json`,
      request: (url, init) => this.updatesRequest(url, init),
      confirmDownload: async version => {
        const copy = desktopNativeCopy(this.locale)
        const result = await this.openDialog({
          type: 'info',
          title: copy.updateAvailableTitle,
          message: copy.updateAvailableMessage(version),
          detail: copy.downloadUpdate,
          buttons: [copy.download, copy.later],
          defaultId: 1,
          cancelId: 1,
        })
        return result.response === 0
      },
      showManualCheckResult: async result => {
        const copy = desktopNativeCopy(this.locale)
        const dialog = result === null
          ? {
              type: 'warning' as const,
              title: copy.updateCheckFailedTitle,
              message: copy.updateCheckFailedMessage,
              detail: copy.tryAgainLater,
            }
          : result.status === 'update-available' && this.updates.canDownload
            ? undefined
            : result.status === 'update-available'
              ? {
                  type: 'info' as const,
                  title: copy.upToDateTitle,
                  message: copy.upToDateMessage,
                  detail: copy.installerUnavailable,
                }
              : {
                  type: 'info' as const,
                  title: copy.upToDateTitle,
                  message: copy.upToDateMessage,
                  detail: copy.installedVersion(result.currentVersion),
                }
        if (dialog === undefined) return
        await this.openDialog({
          ...dialog,
          buttons: [copy.ok],
          defaultId: 0,
          cancelId: 0,
        })
      },
      downloadAndOpen: (version, signal) => this.downloadUpdateInstaller(version, signal),
      notify: notification => { this.native(NATIVE_METHODS.notify, notification) },
    }
    this.unsubscribers.push(transport.on(NATIVE_EVENTS.trayInvoke, params => {
      void this.handleTrayInvoke(params)
    }))
  }

  get rendererBootFailureReason(): RendererHealthFailureReason | undefined {
    return this.rendererHealthGate?.failureReason
  }

  beginRendererBootMonitoring(
    options: { commitHealthy: () => Promise<void> },
    timeoutMs = 30_000,
  ): Promise<RendererHealthVerdict> {
    if (this.rendererHealthGate !== undefined) {
      throw new Error('dsh-desktop: renderer boot monitoring already started')
    }
    const gate = new DesktopRendererHealthGate(options)
    this.rendererHealthGate = gate
    return gate.begin(timeoutMs)
  }

  stopRendererBootMonitoring(): void {
    this.rendererHealthGate?.stop()
  }

  schedule(spec: DesktopShellPayload | DesktopShellSpec): () => Promise<void> {
    if (this.scheduled !== undefined || this.mountTask !== undefined) {
      throw new Error('dsh-desktop: a native shell generation is already registered')
    }
    const payload = this.serializablePayload(spec)
    this.scheduled = payload
    this.scheduledSpec = 'requestModeChange' in spec ? spec : undefined
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      try {
        await this.mountTask
      } finally {
        if (this.generationId !== undefined) {
          await this.transport.request(NATIVE_METHODS.release, { generationId: this.generationId })
        }
        this.generationId = undefined
        this.mountTask = undefined
        if (this.scheduled === payload) {
          this.scheduled = undefined
          this.scheduledSpec = undefined
        }
      }
    }
  }

  mountScheduled(beforeInteractive?: () => void): Promise<void> {
    const spec = this.scheduled
    if (spec === undefined) {
      return Promise.reject(new Error('dsh-desktop: the Host did not register a window'))
    }
    if (this.mountTask === undefined) {
      const live = this.scheduledSpec
      if (live !== undefined) {
        this.setLocalePreference(live.readLocalePreference())
        this.setThemeSource(live.readThemeSource())
        this.registerTrayItem({
          group: 'mode',
          order: 1_000,
          label: () => this.modeToggleLabel(live.mode),
          invoke: () => live.requestModeChange(this.nextMode(live.mode)),
        })
      }
      this.mountTask = this.transport.request<{ generationId: string }>(NATIVE_METHODS.schedule, spec)
        .then(async scheduled => {
          this.generationId = scheduled.generationId
          await this.transport.request(NATIVE_METHODS.mount, { generationId: scheduled.generationId })
          this.rendererHealthGate?.acceptNativeMount()
          beforeInteractive?.()
        })
        .catch(cause => {
          this.generationId = undefined
          throw cause
        })
    }
    return this.mountTask
  }

  private serializablePayload(spec: DesktopShellPayload | DesktopShellSpec): DesktopShellPayload {
    const themeSource = 'readThemeSource' in spec ? spec.readThemeSource() : spec.themeSource
    const locale = 'readLocalePreference' in spec ? spec.readLocalePreference() ?? this.locale : spec.locale
    return {
      mode: spec.mode,
      macosMaterial: spec.macosMaterial,
      windowsMaterial: spec.windowsMaterial,
      width: spec.width,
      height: spec.height,
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      material: spec.material,
      ...(spec.windowsBuild === undefined ? {} : { windowsBuild: spec.windowsBuild }),
      url: spec.url,
      ...(spec.rendererAccessHeader === undefined ? {} : { rendererAccessHeader: spec.rendererAccessHeader }),
      productName: spec.productName,
      windowTitle: spec.windowTitle,
      iconPath: spec.iconPath,
      trayIcons: spec.trayIcons,
      locale,
      themeSource,
    }
  }

  private nextMode(mode: DesktopShellMode): DesktopShellMode {
    if (mode === 'compatibility') return 'extended'
    if (mode === 'extended') return 'advanced'
    return 'compatibility'
  }

  private modeToggleLabel(mode: DesktopShellMode): string {
    if (mode === 'compatibility') return desktopTrayLabel(this.locale, 'switchToExtended')
    if (mode === 'extended') return desktopTrayLabel(this.locale, 'switchToAdvanced')
    return desktopTrayLabel(this.locale, 'switchToCompatibility')
  }

  private native(method: string, params?: unknown): void {
    void this.transport.request(method, params).then(
      () => undefined,
      cause => {
        process.stderr.write(
          `dsh-desktop: native ${method} failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
        )
      },
    )
  }

  show(): void {
    this.native(NATIVE_METHODS.show, { generationId: this.generationId })
  }

  notifyAttention(notification: DesktopNotification): void {
    this.native(NATIVE_METHODS.notifyAttention, notification)
  }

  registerTrayItem(item: DesktopTrayItem): DesktopTrayItemRegistration {
    const id = `tray-${String(this.traySeq)}`
    this.traySeq += 1
    const submenu = item.submenu?.() ?? []
    this.tray.set(id, { id, item, submenu: [...submenu] })
    this.pushTray(id)
    let active = true
    return {
      refresh: () => {
        if (!active) return
        const current = this.tray.get(id)
        if (current === undefined) return
        current.submenu.splice(0, current.submenu.length, ...(item.submenu?.() ?? []))
        this.pushTray(id)
      },
      dispose: () => {
        if (!active) return
        active = false
        this.tray.delete(id)
        this.native(NATIVE_METHODS.trayRemove, { id })
      },
    }
  }

  configureTerminal(spec: DesktopTerminalSpec): void {
    if (this.terminalSpec !== undefined) {
      throw new Error('dsh-desktop: terminal profile is already configured')
    }
    this.terminalSpec = { ...spec }
  }

  setTerminalRuntime(runtime: DesktopTerminalRuntime): void {
    this.terminalRuntime = runtime
  }

  openTerminal(): void {
    if (this.terminalSpec === undefined) {
      throw new Error('dsh-desktop: terminal profile is not configured')
    }
    if (this.userDataDir.length === 0) {
      this.native(NATIVE_METHODS.openTerminal, this.terminalSpec)
      return
    }
    try {
      const runtime = this.terminalRuntime
      const launch = prepareDesktopTerminal({
        platform: this.platform,
        profileName: this.terminalSpec.profileName,
        profileDir: this.terminalSpec.profileDir,
        homeDir: this.terminalSpec.homeDir,
        stateDir: desktopTerminalStateDirectory(this.userDataDir, this.terminalSpec.profileName),
        productVersion: runtime?.productVersion ?? this.updates.currentVersion,
        ...(runtime === undefined ? {} : {
          nodeExecutable: runtime.nodeExecutable,
          dshBootstrapPath: runtime.dshBootstrapPath,
          pnpmBinPath: runtime.pnpmBinPath,
          nodeVersion: runtime.nodeVersion,
        }),
      })
      this.native(NATIVE_METHODS.openTerminal, {
        ...this.terminalSpec,
        command: launch.command,
        scriptPath: launch.welcomePath,
        ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
        ...(launch.environment === undefined ? {} : { environment: launch.environment }),
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      process.stderr.write(`dsh-desktop: failed to open terminal: ${message}\n`)
      this.reportTerminalLaunchError(message)
    }
  }

  private reportTerminalLaunchError(detail: string): void {
    const copy = desktopNativeCopy(this.locale)
    void this.openDialog({
      type: 'error',
      title: copy.terminalErrorTitle,
      message: copy.terminalErrorMessage,
      detail,
      buttons: [copy.ok],
      defaultId: 0,
      cancelId: 0,
    }).then(
      () => undefined,
      cause => {
        process.stderr.write(
          `dsh-desktop: failed to show terminal error dialog: ${cause instanceof Error ? cause.message : String(cause)}\n`,
        )
      },
    )
  }

  reloadRenderer(): void {
    if (this.generationId === undefined) {
      throw new Error('dsh-desktop: renderer reload requires an active shell generation')
    }
    this.native(NATIVE_METHODS.reloadRenderer, { generationId: this.generationId })
  }

  toggleDeveloperTools(): void {
    if (this.generationId === undefined) {
      throw new Error('dsh-desktop: Developer Tools require an active shell generation')
    }
    this.native(NATIVE_METHODS.toggleDeveloperTools, { generationId: this.generationId })
  }

  async exportDiagnostics(): Promise<void> {
    if (this.diagnosticExport !== undefined) return this.diagnosticExport
    const operation = this.performDiagnosticExport().finally(() => {
      if (this.diagnosticExport === operation) this.diagnosticExport = undefined
    })
    this.diagnosticExport = operation
    return operation
  }

  private async performDiagnosticExport(): Promise<void> {
    const copy = desktopDiagnosticsPrivacyCopy(this.locale)
    try {
      const confirmation = await this.openDialog({
        type: 'warning',
        title: copy.title,
        message: copy.message,
        detail: copy.detail,
        buttons: [copy.confirm, copy.cancel],
        defaultId: 1,
        cancelId: 1,
      })
      if (confirmation.response !== 0) return
      const exported = await this.transport.request<{ path?: string }>(NATIVE_METHODS.exportDiagnostics, {
        locale: this.locale,
        ...(this.terminalRuntime?.nodeVersion === undefined
          ? {}
          : { nodeVersion: this.terminalRuntime.nodeVersion }),
      })
      if (exported.path !== undefined && exported.path.length > 0) {
        await this.transport.request(NATIVE_METHODS.revealItem, { path: exported.path })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      process.stderr.write(`dsh-desktop: failed to export diagnostics: ${message}\n`)
      await this.showDiagnosticsExportError(message)
    }
  }

  private async showDiagnosticsExportError(detail: string): Promise<void> {
    const copy = desktopNativeCopy(this.locale)
    await this.openDialog({
      type: 'error',
      title: copy.diagnosticsErrorTitle,
      message: copy.diagnosticsErrorMessage,
      detail,
      buttons: [copy.ok],
      defaultId: 0,
      cancelId: 0,
    }).then(
      () => undefined,
      () => undefined,
    )
  }

  async pickDirectory(): Promise<string | null> {
    const result = await this.transport.request<{ path: string | null }>(NATIVE_METHODS.pickDirectory, {
      title: volumeAdmissionCopy(this.locale).pickerTitle,
    })
    return result.path
  }

  async validateDirectory(path: string): Promise<boolean> {
    const result = await this.transport.request<{ ok?: boolean, decision?: string, fileSystem?: string }>(
      NATIVE_METHODS.validateDirectory,
      { path },
    )
    if (result.decision === undefined || result.decision === 'allow') {
      return result.ok !== false
    }
    const copy = volumeAdmissionCopy(this.locale)
    if (result.decision === 'confirm') {
      const dialog = copy.confirm(path)
      const confirmed = await this.openDialog({
        type: 'warning',
        title: dialog.title,
        message: dialog.message,
        detail: dialog.detail,
        buttons: dialog.buttons,
        defaultId: dialog.defaultId,
        cancelId: dialog.cancelId,
      })
      return confirmed.response === 0
    }
    const dialog = copy.block(result.fileSystem ?? 'This filesystem', path)
    await this.openDialog({
      type: 'error',
      title: dialog.title,
      message: dialog.message,
      detail: dialog.detail,
      buttons: dialog.buttons,
      defaultId: dialog.defaultId,
      cancelId: dialog.cancelId,
    }).then(
      () => undefined,
      () => undefined,
    )
    return false
  }

  reportRendererBoot(report: RendererBootReport): void {
    const consumedByGate = this.rendererHealthGate !== undefined
    this.rendererHealthGate?.report(report)
    this.native(NATIVE_METHODS.reportRendererBoot, report)
    if (report.status === 'failed' && !consumedByGate && this.rendererBootDialogTask === undefined) {
      const task = this.showRendererBootRecovery(report).finally(() => {
        if (this.rendererBootDialogTask === task) this.rendererBootDialogTask = undefined
      })
      this.rendererBootDialogTask = task
    }
  }

  private async showRendererBootRecovery(
    report: Extract<RendererBootReport, { status: 'failed' }>,
  ): Promise<void> {
    const copy = desktopNativeCopy(this.locale)
    const plugins = report.plugins.length === 0
      ? copy.unknownPlugin
      : report.plugins.map(plugin => `- ${plugin}`).join('\n')
    const error = report.error === undefined ? copy.missingPluginError : report.error
    const result = await this.openDialog({
      type: 'error',
      title: copy.pluginRecoveryTitle,
      message: copy.pluginRecoveryMessage,
      detail: `${copy.failedPlugins}\n${plugins}\n\n${error}\n\n${copy.pluginRecoveryInstructions}`,
      buttons: [copy.openTerminal, copy.restart, copy.dismiss],
      defaultId: 0,
      cancelId: 2,
    })
    if (result.response === 0) {
      this.openTerminal()
    } else if (result.response === 1) {
      await this.requestRestart()
    }
  }

  openProfileCreateWindow(options: ProfileCreateWindowOptions): void {
    this.profileCreate = options
    this.native(NATIVE_METHODS.openProfileCreate, { locale: this.locale })
  }

  submitProfileCreate(name: string): void {
    void this.profileCreate?.onSubmit(name)
  }

  setLocalePreference(preference: DesktopLocale | undefined): void {
    const locale = preference ?? desktopLocaleFromLanguageTag(this.systemLocaleTag())
    if (locale === this.locale) return
    this.locale = locale
    this.native(NATIVE_METHODS.setLocale, { locale: this.locale })
  }

  setThemeSource(source: DesktopThemeSource): void {
    this.native(NATIVE_METHODS.setTheme, { source })
  }

  async requestRestart(): Promise<void> {
    if (this.quitting) return
    if (this.restartRequest !== undefined) return this.restartRequest
    const request = this.confirmAndRestart('normal').finally(() => {
      if (this.restartRequest === request) this.restartRequest = undefined
    })
    this.restartRequest = request
    await request
  }

  async requestRecoveryRestart(): Promise<void> {
    if (this.quitting) return
    if (this.restartRequest !== undefined) return this.restartRequest
    const request = this.confirmAndRestart('recovery').finally(() => {
      if (this.restartRequest === request) this.restartRequest = undefined
    })
    this.restartRequest = request
    await request
  }

  private async confirmAndRestart(target: 'normal' | 'recovery'): Promise<void> {
    const copy = desktopRestartConfirmationCopy(this.locale, target)
    const result = await this.openDialog({
      type: 'question',
      title: copy.title,
      message: copy.message,
      detail: copy.detail,
      buttons: [copy.confirm, copy.cancel],
      defaultId: 1,
      cancelId: 1,
    })
    if (result.response !== 0) return
    await this.transport.request(target === 'recovery' ? NATIVE_METHODS.restartRecovery : NATIVE_METHODS.restart)
  }

  prepareToQuit(): void {
    this.quitting = true
    this.stopRendererBootMonitoring()
    this.native(NATIVE_METHODS.prepareToQuit)
  }

  private async downloadUpdateInstaller(version: string, signal: AbortSignal): Promise<void> {
    const copy = desktopNativeCopy(this.locale)
    if (this.platform === 'win32') {
      const install = await this.openDialog({
        type: 'question',
        title: copy.updateDownloadedTitle,
        message: copy.updateReady(version),
        detail: copy.windowsInstallQuestion,
        buttons: [copy.restartAndInstall, copy.later],
        defaultId: 1,
        cancelId: 1,
      })
      if (install.response !== 0) return
    }
    const artifactName = this.platform === 'darwin'
      ? `DSH-Desktop-${version}-mac.dmg`
      : `DSH-Desktop-${version}-windows.exe`
    const saved = await this.transport.request<{ path: string | null }>(NATIVE_METHODS.saveDialog, {
      title: copy.saveInstallerTitle,
      defaultPath: artifactName,
      buttonLabel: copy.saveAndDownload,
    })
    const destination = saved.path
    if (destination === null || destination.length === 0) return
    const path = await downloadDesktopUpdate({
      platform: this.platform === 'win32' ? 'win32' : 'darwin',
      version,
      destinationPath: destination,
      request: this.updatesRequest,
      signal,
    })
    await this.transport.request(NATIVE_METHODS.openUpdate, { path })
    if (this.platform === 'darwin') {
      await this.openDialog({
        type: 'info',
        title: copy.updateDownloadedTitle,
        message: copy.updateReady(version),
        detail: copy.macInstallInstructions,
        buttons: [copy.ok],
        defaultId: 0,
        cancelId: 0,
      }).then(
        () => undefined,
        () => undefined,
      )
    }
  }

  async openDialog(options: DesktopDialogOptions): Promise<DesktopDialogResult> {
    return await this.transport.request<DesktopDialogResult>(NATIVE_METHODS.openDialog, options)
  }

  async openRecovery(state: unknown): Promise<void> {
    await this.transport.request(NATIVE_METHODS.openRecovery, { state })
  }

  openProfileCreate(state: unknown): void {
    this.native(NATIVE_METHODS.openProfileCreate, { state })
  }

  openDevtools(options: { tab: 'logs' | 'network', origin: string }): void {
    this.native(NATIVE_METHODS.openDevtools, options)
  }

  async persistBootstrap(profileName: string, mode: DesktopShellMode): Promise<void> {
    await this.transport.request(NATIVE_METHODS.writeBootstrap, { profileName, mode })
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe()
    this.unsubscribers.length = 0
  }

  private snapshot(entry: RegisteredTray): DesktopTrayItemSnapshot {
    const submenu: DesktopTraySubmenuSnapshot[] = entry.submenu.map((item, index) => ({
      id: `${entry.id}:${String(index)}`,
      label: item.label(),
      ...(item.type === undefined ? {} : { type: item.type }),
      enabled: item.enabled?.() ?? true,
      checked: item.checked?.() ?? false,
    }))
    return {
      id: entry.id,
      group: entry.item.group,
      order: entry.item.order,
      label: entry.item.label(),
      enabled: entry.item.enabled?.() ?? true,
      ...(submenu.length === 0 ? {} : { submenu }),
    }
  }

  private pushTray(id: string): void {
    const entry = this.tray.get(id)
    if (entry === undefined) return
    this.native(NATIVE_METHODS.trayUpsert, this.snapshot(entry))
  }

  private async handleTrayInvoke(params: unknown): Promise<void> {
    if (params === null || typeof params !== 'object') return
    const record = params as { id?: unknown, submenuIndex?: unknown }
    if (typeof record.id !== 'string') return
    const entry = this.tray.get(record.id)
    if (entry === undefined) return
    if (typeof record.submenuIndex === 'number') {
      await entry.submenu[record.submenuIndex]?.invoke()
      return
    }
    await entry.item.invoke()
  }
}
