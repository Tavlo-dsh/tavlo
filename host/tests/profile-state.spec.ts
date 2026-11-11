import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertDesktopProfileName,
  loadProfileState,
  parseProfileState,
  writeProfileState,
} from '../src/runtime/profile-state.ts'
import { loadNativeBootstrap, parseNativeBootstrap, writeNativeBootstrap } from '../src/runtime/native-bootstrap.ts'

describe('profile selection and native bootstrap', () => {
  it('parses version 2 selection state', () => {
    expect(parseProfileState('{"version":2,"active":"desktop"}\n')).toEqual({
      version: 2,
      active: 'desktop',
    })
  })

  it('recovers malformed state to desktop without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-'))
    const path = join(dir, 'state.json')
    writeFileSync(path, '{nope')
    expect(loadProfileState(path)).toEqual({
      state: { version: 2, active: 'desktop' },
      recovered: true,
    })
  })

  it('treats a missing file as the default desktop profile', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-missing-'))
    expect(loadProfileState(join(dir, 'state.json'))).toEqual({
      state: { version: 2, active: 'desktop' },
      recovered: false,
    })
  })

  it('rejects unsafe profile names', () => {
    expect(() => assertDesktopProfileName('../etc')).toThrow('invalid desktop profile name')
    expect(() => assertDesktopProfileName('CON')).toThrow('invalid desktop profile name')
  })

  it('round-trips the two-field native bootstrap document', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-bootstrap-'))
    mkdirSync(dir, { recursive: true })
    writeNativeBootstrap(dir, 'web', 'extended')
    expect(loadNativeBootstrap(dir)).toEqual({ version: 1, profileName: 'web', mode: 'extended' })
    expect(parseNativeBootstrap('{"version":1,"profileName":"desktop","mode":"compatibility"}')).toEqual({
      version: 1,
      profileName: 'desktop',
      mode: 'compatibility',
    })
  })

  it('persists a selected profile name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-write-'))
    const path = join(dir, 'state.json')
    writeProfileState(path, { version: 2, active: 'web' })
    expect(loadProfileState(path).state.active).toBe('web')
  })
})
