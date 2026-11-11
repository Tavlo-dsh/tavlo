import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exportDiagnosticsArchive } from './diagnostics.ts'
import { writeNativeBootstrap, loadNativeBootstrap } from './native-bootstrap.ts'
import { writeProfileState, profileSelectionStatePath, assertDesktopProfileName } from './profile-state.ts'
import type { RecoveryAction } from './recovery-href.ts'

export type RecoveryEffect =
  | { readonly kind: 'restart' }
  | { readonly kind: 'quit' }
  | { readonly kind: 'diagnostics', readonly path: string }
  | { readonly kind: 'profile', readonly profileName: string }
  | { readonly kind: 'ignored' }

export function persistLifecycle(userDataDir: string, action: 'restart' | 'quit' | 'recovery'): string {
  const path = join(userDataDir, 'lifecycle.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ action }, undefined, 2)}\n`)
  return path
}

export function applyProfileSelection(userDataDir: string, name: string): string {
  assertDesktopProfileName(name)
  writeProfileState(profileSelectionStatePath(userDataDir), { version: 2, active: name })
  const mode = loadNativeBootstrap(userDataDir).mode
  writeNativeBootstrap(userDataDir, name, mode)
  return name
}

export function applyRecoveryAction(userDataDir: string, action: RecoveryAction, appVersion = '0.1.0'): RecoveryEffect {
  if (action.action === 'restart') {
    persistLifecycle(userDataDir, 'restart')
    return { kind: 'restart' }
  }
  if (action.action === 'quit') {
    persistLifecycle(userDataDir, 'quit')
    return { kind: 'quit' }
  }
  if (action.action === 'save-diagnostics') {
    return { kind: 'diagnostics', path: exportDiagnosticsArchive(userDataDir, appVersion) }
  }
  if (action.action === 'add-profile' || action.action === 'switch-profile') {
    if (action.name === undefined) throw new Error('profile name required')
    return { kind: 'profile', profileName: applyProfileSelection(userDataDir, action.name) }
  }
  return { kind: 'ignored' }
}
