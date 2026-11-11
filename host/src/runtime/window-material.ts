import type {
  DesktopPlatform,
  DesktopShellMode,
  DesktopWindowMaterial,
  MacosWindowMaterial,
  PersistedWindowsWindowMaterial,
  WindowsWindowMaterial,
} from './types.ts'
import { release as osRelease } from 'node:os'

export const DEFAULT_MACOS_WINDOW_MATERIAL: MacosWindowMaterial = 'transparent'
export const DEFAULT_WINDOWS_WINDOW_MATERIAL: WindowsWindowMaterial = 'off'
export const WINDOWS_MICA_MIN_BUILD = 22_621

export function windowsBuildNumber(value: string = osRelease()): number | undefined {
  const match = /^(?:\d+\.){2}(\d+)(?:\.|$)/.exec(value)
  if (match === null) return undefined
  const build = Number(match[1])
  return Number.isSafeInteger(build) ? build : undefined
}

export function windowsSupportsSystemBackdrop(build: number | undefined): boolean {
  return build !== undefined && build >= WINDOWS_MICA_MIN_BUILD
}

export function windowsSupportsMica(build: number | undefined): boolean {
  return windowsSupportsSystemBackdrop(build)
}

export function parseMacosWindowMaterial(value: unknown): MacosWindowMaterial {
  if (value === undefined) return DEFAULT_MACOS_WINDOW_MATERIAL
  if (value === 'off' || value === 'transparent') return value
  throw new Error('dsh-desktop.macosMaterial must be "off" or "transparent"')
}

export function parseWindowsWindowMaterial(value: unknown): WindowsWindowMaterial {
  if (value === undefined) return DEFAULT_WINDOWS_WINDOW_MATERIAL
  if (value === 'off' || value === 'mica') return value
  // Acrylic was removed because both Windows implementations can break native
  // window behavior. Keep the legacy value readable and fail closed to opaque.
  if (value === 'acrylic') return 'off'
  throw new Error('dsh-desktop.windowsMaterial must be "off" or "mica"')
}

export function effectiveDesktopWindowMaterial(
  mode: DesktopShellMode,
  platform: DesktopPlatform,
  macosMaterial: MacosWindowMaterial,
  windowsMaterial: PersistedWindowsWindowMaterial,
  windowsBuild: number | undefined,
): DesktopWindowMaterial {
  void mode
  if (platform === 'linux') return 'off'
  if (platform === 'darwin') return macosMaterial
  if (windowsMaterial === 'acrylic') return 'off'
  if (windowsMaterial === 'mica' && !windowsSupportsSystemBackdrop(windowsBuild)) return 'off'
  return windowsMaterial
}
