import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function officialHostDisabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const value = environment.DSH_OFFICIAL_HOST
  return value === '0' || value === 'false' || value === 'off'
}

export function officialHostEntry(
  pluginRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (officialHostDisabled(environment)) return undefined
  const entry = join(pluginRoot, 'lib/tauri-host.js')
  return existsSync(entry) ? entry : undefined
}
