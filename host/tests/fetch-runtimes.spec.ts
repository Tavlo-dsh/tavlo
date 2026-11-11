import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadRuntimeLock,
  runtimeLayout,
  runtimePlatformKey,
  stampFor,
  stampMatches,
} from '../../scripts/fetch-runtimes.mjs'

describe('bundled JS runtimes', () => {
  it('maps darwin/linux arches to lock keys', () => {
    expect(runtimePlatformKey('darwin', 'arm64')).toBe('darwin-arm64')
    expect(runtimePlatformKey('darwin', 'x64')).toBe('darwin-x64')
    expect(() => runtimePlatformKey('win32', 'arm64')).toThrow(/no bundled JS runtime/)
  })

  it('pins bun and node into vendor/runtimes', () => {
    const lock = loadRuntimeLock()
    expect(lock.bun.version).toBe('1.4.0')
    expect(lock.node.version).toBe('22.20.0')
    expect(lock.bun.targets['darwin-arm64'].url).toContain('bun-darwin-aarch64.zip')
    expect(lock.node.targets['darwin-arm64'].archiveMember).toContain('/bin/node')
    const layout = runtimeLayout('/app/vendor/runtimes', false)
    expect(layout.bun).toBe('/app/vendor/runtimes/bun')
    expect(layout.node).toBe('/app/vendor/runtimes/node')
  })

  it('skips refetch when stamp matches lock and platform', () => {
    const lock = loadRuntimeLock()
    const expected = stampFor(lock, 'darwin-arm64')
    expect(stampMatches(expected, expected)).toBe(true)
    expect(stampMatches({ ...expected, bun: '0.0.0' }, expected)).toBe(false)
    const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-stamp-'))
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'stamp.json'), JSON.stringify(expected))
    expect(stampMatches(expected, stampFor(lock, 'darwin-arm64'))).toBe(true)
  })
})
