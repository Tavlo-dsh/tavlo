export const ADVANCED_MACOS_CONTENT_INSET = 20
export const ADVANCED_MACOS_DRAG_REGION_HEIGHT = 32
export const ADVANCED_MACOS_TRAFFIC_LIGHT_TOP = 16
export const MACOS_TRAFFIC_LIGHT_SAFE_WIDTH = 80
export const ADVANCED_WINDOWS_TITLEBAR_HEIGHT = 32
export const WINDOWS_CAPTION_CONTROLS_WIDTH = 138
export const DESKTOP_FRAME_HEIGHT = 36
export const DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP = 12
export const EXTENDED_INNER_CORNER_RADIUS = 10

export interface WindowChromeGeometry {
  readonly titlebarHeight: number
  readonly macosTrafficLightTop: number
}

export function chromeGeometry(mode: 'compatibility' | 'extended' | 'advanced'): WindowChromeGeometry {
  if (mode === 'advanced') {
    return {
      titlebarHeight: ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
      macosTrafficLightTop: ADVANCED_MACOS_TRAFFIC_LIGHT_TOP,
    }
  }
  return {
    titlebarHeight: DESKTOP_FRAME_HEIGHT,
    macosTrafficLightTop: DESKTOP_FRAME_MACOS_TRAFFIC_LIGHT_TOP,
  }
}
