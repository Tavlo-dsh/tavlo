export const DESKTOP_FILE_PATH_BRIDGE = '__DSH_DESKTOP_FILE_PATH__'
export const FOLDER_DROP_EVENT = 'dsh-desktop-folder-drop'

export interface DesktopFilePathBridge {
  getPathForFile(file: File): string
}

export interface FolderDropDetail {
  readonly paths: readonly string[]
  readonly x: number
  readonly y: number
}

/** Accept exactly one dropped folder path from the native drag interceptor. */
export function singleDroppedFolderPath(detail: FolderDropDetail): string | undefined {
  if (detail.paths.length !== 1) return undefined
  const path = detail.paths[0]?.trim()
  return path === undefined || path.length === 0 ? undefined : path
}

export function createFilePathBridge(pending: { path?: string }): DesktopFilePathBridge {
  return {
    getPathForFile(file: File): string {
      const tagged = (file as File & { __dshPath?: unknown }).__dshPath
      if (typeof tagged === 'string' && tagged.trim().length > 0) return tagged.trim()
      return pending.path?.trim() ?? ''
    },
  }
}

export function applyNativeFolderDrop(
  pending: { path?: string },
  detail: FolderDropDetail,
): string | undefined {
  const path = singleDroppedFolderPath(detail)
  if (path === undefined) {
    delete pending.path
    return undefined
  }
  pending.path = path
  return path
}
