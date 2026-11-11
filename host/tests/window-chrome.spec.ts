import { describe, expect, it } from 'vitest'
import {
  ADVANCED_MACOS_TRAFFIC_LIGHT_TOP,
  ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
  DESKTOP_FRAME_HEIGHT,
  DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP,
  chromeGeometry,
} from '../src/runtime/window-chrome.ts'
import {
  applicationNeedsReveal,
  macosTrafficLightButtonOriginY,
  macosTrafficLightWryInsetY,
  nextWindowMaximized,
  shouldHandleTitlebarDblclick,
} from '../src/runtime/window-ops.ts'

describe('window chrome geometry', () => {
  it('keeps the 36px frame for compatibility and extended', () => {
    expect(chromeGeometry('compatibility')).toEqual({
      titlebarHeight: DESKTOP_FRAME_HEIGHT,
      macosTrafficLightTop: DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP,
    })
    expect(chromeGeometry('extended').titlebarHeight).toBe(36)
    expect(macosTrafficLightWryInsetY(DESKTOP_FRAME_HEIGHT)).toBe(24)
    expect(macosTrafficLightButtonOriginY(DESKTOP_FRAME_HEIGHT, 12)).toBe(DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP)
  })

  it('uses the compact enhanced caption', () => {
    expect(chromeGeometry('advanced')).toEqual({
      titlebarHeight: ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
      macosTrafficLightTop: ADVANCED_MACOS_TRAFFIC_LIGHT_TOP,
    })
  })

  it('double-clicks the frame to zoom and skips titlebar controls', () => {
    expect(shouldHandleTitlebarDblclick({
      clientY: 4,
      titlebarHeight: DESKTOP_FRAME_HEIGHT,
      interactive: false,
      inTitlebarRegion: true,
    })).toBe(true)
    expect(shouldHandleTitlebarDblclick({
      clientY: 4,
      titlebarHeight: DESKTOP_FRAME_HEIGHT,
      interactive: true,
      inTitlebarRegion: true,
    })).toBe(false)
    expect(nextWindowMaximized(false)).toBe(true)
    expect(nextWindowMaximized(true)).toBe(false)
  })

  it('reveals a hidden macOS window on Dock activate and does not steal focus when already visible', () => {
    expect(applicationNeedsReveal({
      visible: false,
      minimized: false,
      appHidden: false,
      platform: 'darwin',
    })).toBe(true)
    expect(applicationNeedsReveal({
      visible: true,
      minimized: true,
      appHidden: false,
      platform: 'darwin',
    })).toBe(true)
    expect(applicationNeedsReveal({
      visible: true,
      minimized: false,
      appHidden: true,
      platform: 'darwin',
    })).toBe(true)
    expect(applicationNeedsReveal({
      visible: true,
      minimized: false,
      appHidden: false,
      platform: 'darwin',
    })).toBe(false)
  })
})
