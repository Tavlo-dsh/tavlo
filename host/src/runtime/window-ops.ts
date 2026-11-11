import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FOLDER_DROP_EVENT } from './file-path-bridge.ts'
import { chromeGeometry } from './window-chrome.ts'
import { effectiveDesktopWindowMaterial } from './window-material.ts'
import type { DesktopPlatform, DesktopShellMode, DesktopWindowMaterial, MacosWindowMaterial, PersistedWindowsWindowMaterial } from './types.ts'

export interface WindowBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WindowApplyPlan {
  readonly mode: DesktopShellMode
  readonly titlebarHeight: number
  readonly macosTrafficLightTop: number
  readonly material: DesktopWindowMaterial
  readonly zoomLevel: number
  readonly interceptExternalLinks: boolean
  readonly bounds?: WindowBounds
}

export function clampZoom(level: number): number {
  return Math.min(4, Math.max(-4, level))
}

/** Titlebar double-click zoom, matching Electron hiddenInset / -webkit-app-region: drag. */
export function shouldHandleTitlebarDblclick(input: {
  readonly clientY: number
  readonly titlebarHeight: number
  readonly interactive: boolean
  readonly inTitlebarRegion: boolean
}): boolean {
  if (input.interactive) return false
  if (input.inTitlebarRegion) return true
  return input.clientY >= 0 && input.clientY <= input.titlebarHeight
}

export function nextWindowMaximized(currentlyMaximized: boolean): boolean {
  return !currentlyMaximized
}

/** Visual height used to center macOS traffic lights in the Desktop frame. */
export const MACOS_TRAFFIC_LIGHT_BUTTON_HEIGHT = 12
export const MACOS_TRAFFIC_LIGHT_X = 16

export function macosTrafficLightWryInsetY(titlebarHeight: number): number {
  return Math.max(0, titlebarHeight - MACOS_TRAFFIC_LIGHT_BUTTON_HEIGHT)
}

export function macosTrafficLightButtonOriginY(titlebarHeight: number, buttonHeight: number): number {
  return Math.max(0, (titlebarHeight - buttonHeight) / 2)
}

/** Electron `applicationNeedsReveal`: Dock click restores a hidden/minimized window and does not steal focus when already visible. */
export function applicationNeedsReveal(input: {
  readonly visible: boolean
  readonly minimized: boolean
  readonly appHidden: boolean
  readonly platform: DesktopPlatform
}): boolean {
  return input.minimized || !input.visible || (input.platform === 'darwin' && input.appHidden)
}

export function originOf(href: string): string | undefined {
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export function isLoopbackHref(href: string): boolean {
  return href.startsWith('http://127.0.0.1')
    || href.startsWith('http://[::1]')
    || href.startsWith('http://localhost')
}

export function shouldOpenExternally(pageOrigin: string, href: string): boolean {
  if (href.startsWith('mailto:')) return true
  if (isLoopbackHref(href)) return false
  const target = originOf(href)
  const page = originOf(pageOrigin)
  if (target === undefined) return false
  return page === undefined || target !== page
}

export function openExternalHref(
  pageOrigin: string,
  href: string,
  opener: (url: string) => void,
): boolean {
  if (!shouldOpenExternally(pageOrigin, href)) return false
  opener(href)
  return true
}

export function folderDropScript(paths: readonly string[], x: number, y: number): string {
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(FOLDER_DROP_EVENT)}, { detail: ${JSON.stringify({ paths, x, y })} }));`
}

export function persistWindowBounds(userDataDir: string, bounds: WindowBounds): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, 'main-window-state.json'), `${JSON.stringify({ version: 1, bounds }, undefined, 2)}\n`)
}

export function loadWindowBounds(userDataDir: string): WindowBounds | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(join(userDataDir, 'main-window-state.json'), 'utf8'))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const document = value as { version?: unknown, bounds?: Partial<WindowBounds> }
    if (document.version !== 1 || document.bounds === undefined) return undefined
    const x = document.bounds.x
    const y = document.bounds.y
    const width = document.bounds.width
    const height = document.bounds.height
    if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number') {
      return undefined
    }
    if (![x, y, width, height].every(item => Number.isSafeInteger(item)) || width <= 0 || height <= 0) {
      return undefined
    }
    return { x, y, width, height }
  } catch {
    return undefined
  }
}

export function planWindowGeneration(
  platform: DesktopPlatform,
  requestedMode: DesktopShellMode,
  macosMaterial: MacosWindowMaterial,
  windowsMaterial: PersistedWindowsWindowMaterial,
  windowsBuild: number | undefined,
  zoom: number,
  bounds?: WindowBounds,
): WindowApplyPlan {
  const mode: DesktopShellMode = platform === 'linux' && requestedMode !== 'compatibility' ? 'compatibility' : requestedMode
  const chrome = chromeGeometry(mode)
  return {
    mode,
    titlebarHeight: chrome.titlebarHeight,
    macosTrafficLightTop: chrome.macosTrafficLightTop,
    material: effectiveDesktopWindowMaterial(mode, platform, macosMaterial, windowsMaterial, windowsBuild),
    zoomLevel: clampZoom(zoom),
    interceptExternalLinks: true,
    ...(bounds === undefined ? {} : { bounds }),
  }
}
