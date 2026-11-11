import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assertDesktopProfileName } from './profile-state.ts'
import type { DesktopShellMode, NativeBootstrapState } from './types.ts'

export const NATIVE_BOOTSTRAP_FILENAME = 'native-bootstrap.json'

export function nativeBootstrapPath(userDataDir: string): string {
  return join(userDataDir, NATIVE_BOOTSTRAP_FILENAME)
}

export function defaultNativeBootstrap(): NativeBootstrapState {
  return { version: 1, profileName: 'desktop', mode: 'compatibility' }
}

export function parseNativeBootstrap(text: string): NativeBootstrapState {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('native bootstrap must be a JSON object')
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1) throw new Error('native bootstrap version must be 1')
  if (typeof record.profileName !== 'string') throw new Error('native bootstrap profileName must be a string')
  assertDesktopProfileName(record.profileName)
  if (record.mode !== 'compatibility' && record.mode !== 'extended' && record.mode !== 'advanced') {
    throw new Error('native bootstrap mode must be compatibility, extended, or advanced')
  }
  return { version: 1, profileName: record.profileName, mode: record.mode }
}

export function loadNativeBootstrap(userDataDir: string): NativeBootstrapState {
  try {
    return parseNativeBootstrap(readFileSync(nativeBootstrapPath(userDataDir), 'utf8'))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return defaultNativeBootstrap()
    return defaultNativeBootstrap()
  }
}

export function writeNativeBootstrap(
  userDataDir: string,
  profileName: string,
  mode: DesktopShellMode,
): NativeBootstrapState {
  assertDesktopProfileName(profileName)
  const state: NativeBootstrapState = { version: 1, profileName, mode }
  const path = nativeBootstrapPath(userDataDir)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(state, undefined, 2)}\n`, { encoding: 'utf8' })
  return state
}
