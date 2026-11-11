/** Platforms supported by the DSH Desktop native adapter. */
export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

/** Native presentation modes selected by the desktop-shell row. */
export type DesktopShellMode = 'compatibility' | 'extended' | 'advanced'

/** Appearance source used by native frame and material rendering. */
export type DesktopThemeSource = 'system' | 'light' | 'dark'

/** Locale identifiers shared by the Web client and native desktop tray. */
export type DesktopLocale = 'zh' | 'en'

export type MacosWindowMaterial = 'off' | 'transparent'
export type WindowsWindowMaterial = 'off' | 'mica'
/** Persisted compatibility value accepted only so pre-removal settings still boot. */
export type PersistedWindowsWindowMaterial = WindowsWindowMaterial | 'acrylic'
export type DesktopWindowMaterial = MacosWindowMaterial | WindowsWindowMaterial

export type DesktopTrayItemGroup = 'tools' | 'profiles' | 'status' | 'mode'

export interface DesktopTrayIcons {
  readonly templatePath: string
  readonly bluePath: string
}

export interface DesktopNotification {
  readonly title: string
  readonly body: string
}

export interface DesktopWindowConfig {
  readonly mode: DesktopShellMode
  readonly macosMaterial: MacosWindowMaterial
  readonly windowsMaterial: PersistedWindowsWindowMaterial
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
}

/** Generation-scoped capability distinguishing the desktop renderer from ordinary browsers. */
export interface DesktopRendererAccessHeader {
  readonly name: 'x-dsh-desktop-renderer'
  readonly value: string
}

export interface DesktopShellPayload extends DesktopWindowConfig {
  readonly material: DesktopWindowMaterial
  readonly windowsBuild?: number
  readonly url: string
  readonly rendererAccessHeader?: DesktopRendererAccessHeader
  readonly productName: string
  readonly windowTitle: string
  readonly iconPath: string
  readonly trayIcons: DesktopTrayIcons
  readonly locale: DesktopLocale
  readonly themeSource: DesktopThemeSource
}

export interface DesktopShellSpec extends DesktopWindowConfig {
  readonly material: DesktopWindowMaterial
  readonly windowsBuild?: number
  readonly url: string
  /** Ephemeral capability attached by the desktop shell to this renderer generation's requests. */
  readonly rendererAccessHeader: DesktopRendererAccessHeader
  readonly productName: string
  readonly windowTitle: string
  readonly iconPath: string
  readonly trayIcons: DesktopTrayIcons
  readLocalePreference(): DesktopLocale | undefined
  readThemeSource(): DesktopThemeSource
  requestQuit(code: number): void
  requestModeChange(mode: DesktopShellMode): Promise<void>
}

export interface ProfileCreateWindowOptions {
  readonly onSubmit: (name: string) => void | Promise<void>
}

export interface DesktopTerminalSpec {
  readonly profileName: string
  readonly profileDir: string
  readonly homeDir: string
}

export interface DesktopTraySubmenuSnapshot {
  readonly id: string
  readonly label: string
  readonly type?: 'normal' | 'checkbox' | 'radio'
  readonly enabled: boolean
  readonly checked: boolean
}

export interface DesktopTrayItemSnapshot {
  readonly id: string
  readonly group: DesktopTrayItemGroup
  readonly order: number
  readonly label: string
  readonly enabled: boolean
  readonly submenu?: readonly DesktopTraySubmenuSnapshot[]
}

export type RendererBootReport =
  | { readonly status: 'healthy' }
  | { readonly status: 'failed', readonly plugins: readonly string[], readonly error?: string }

export interface DesktopDialogOptions {
  readonly type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  readonly title: string
  readonly message: string
  readonly detail?: string
  readonly buttons: readonly string[]
  readonly defaultId?: number
  readonly cancelId?: number
  readonly windowControls?: boolean
}

export interface DesktopDialogResult {
  readonly response: number
}

export interface NativeBootstrapState {
  readonly version: 1
  readonly profileName: string
  readonly mode: DesktopShellMode
}
