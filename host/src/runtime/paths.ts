import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

export function dshPluginDesktopRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = environment.DSH_PLUGIN_DESKTOP_ROOT
  if (explicit !== undefined && explicit.length > 0) return explicit
  const here = dirname(fileURLToPath(import.meta.url))
  const dotted = join(here, '../../../.anywhere-labs-dsh-desktop/dsh-plugin-desktop')
  const undotted = join(here, '../../../anywhere-labs-dsh-desktop/dsh-plugin-desktop')
  if (existsSync(join(dotted, 'lib/tauri-host.js'))) return dotted
  if (existsSync(join(undotted, 'lib/tauri-host.js'))) return undotted
  return dotted
}

export function defaultDesktopUserDataDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  const path = platform === 'win32' ? win32 : posix
  if (platform === 'win32') {
    const appData = environment.APPDATA
    if (appData === undefined || appData.length === 0) {
      throw new Error('APPDATA is unavailable; cannot locate DSH Desktop data')
    }
    return path.join(appData, 'DSH Desktop')
  }
  if (platform === 'darwin') return path.join(homeDirectory, 'Library', 'Application Support', 'DSH Desktop')
  const config = environment.XDG_CONFIG_HOME
  return path.join(config === undefined || config.length === 0 ? path.join(homeDirectory, '.config') : config, 'DSH Desktop')
}

export function defaultDshHome(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): string {
  if (environment.DSH_HOME !== undefined && environment.DSH_HOME.length > 0) return environment.DSH_HOME
  const path = platform === 'win32' ? win32 : posix
  return path.join(homeDirectory, '.dsh')
}
