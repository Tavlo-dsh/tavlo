import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LOADABLE_KERNEL_COMMIT,
  LOADABLE_KERNEL_TAG,
  LOADABLE_KERNEL_VERSION,
  assertLoadableProductPin,
  assertPinInvariants,
  parseKernelPin,
} from '../src/runtime/kernel-pin.ts'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const pinPath = join(repoRoot, 'docs/kernel-pin.json')

const LATEST_TAG = 'dsh-v0.1.2-alpha.1'
const LATEST_TAG_COMMIT = 'cd5ef8148158c3a752a658978873241fdf8e2bbc'

function validPin(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
    localPath: '.deepseek-harness',
    track: 'latest-dsh-v-tag',
    commit: LOADABLE_KERNEL_COMMIT,
    tag: LOADABLE_KERNEL_TAG,
    sourceVersion: LOADABLE_KERNEL_VERSION,
    runtimePackageVersion: LOADABLE_KERNEL_VERSION,
    npmPublished: true,
    consumption: 'npm',
    latestTag: LATEST_TAG,
    latestTagCommit: LATEST_TAG_COMMIT,
    commitsAhead: 1079,
    checkedAt: '2026-08-28',
    ...overrides,
  }
}

describe('docs/kernel-pin.json', () => {
  it('loads the real pin file as a harness-only latest-tag track with a loadable rc.2 kernel', () => {
    const raw = JSON.parse(readFileSync(pinPath, 'utf8')) as unknown
    const pin = parseKernelPin(raw)
    assertPinInvariants(pin)
    assertLoadableProductPin(pin)
    expect(pin.repository).toBe('https://github.com/deepseek-ai/deepseek-harness.git')
    expect(pin.track).toBe('latest-dsh-v-tag')
    expect(pin.tag).toBe(LOADABLE_KERNEL_TAG)
    expect(pin.commit).toBe(LOADABLE_KERNEL_COMMIT)
    expect(pin.sourceVersion).toBe(LOADABLE_KERNEL_VERSION)
    expect(pin.runtimePackageVersion).toBe(LOADABLE_KERNEL_VERSION)
    expect(pin.sourceVersion).toBe(pin.runtimePackageVersion)
    expect(pin.npmPublished).toBe(true)
    expect(pin.consumption).toBe('npm')
    expect(pin.latestTag).toBe(LATEST_TAG)
    expect(pin.latestTagCommit).toBe(LATEST_TAG_COMMIT)
    expect(pin.tag).not.toBe(pin.latestTag)
    expect(pin.runtimePackageVersion).not.toBe('0.1.2-alpha.1')
    expect(pin.commit).not.toBe(LATEST_TAG_COMMIT)
  })

  it('rejects the old dual-upstream / missing-gap pin shape', () => {
    expect(() => parseKernelPin({
      repository: 'https://github.com/deepseek-ai/deepseek-harness.git',
      localPath: '.deepseek-harness',
      commit: LOADABLE_KERNEL_COMMIT,
      tag: LOADABLE_KERNEL_TAG,
      sourceVersion: LOADABLE_KERNEL_VERSION,
      runtimePackageVersion: LOADABLE_KERNEL_VERSION,
      checkedAt: '2026-08-28',
    })).toThrow()
  })

  it('rejects a pin that already bumped the loadable kernel to unpublished 0.1.2-alpha.1', () => {
    const bumped = validPin({
      commit: LATEST_TAG_COMMIT,
      tag: LATEST_TAG,
      sourceVersion: '0.1.2-alpha.1',
      runtimePackageVersion: '0.1.2-alpha.1',
      npmPublished: false,
      consumption: 'packed-from-checkout',
      latestTag: LATEST_TAG,
      latestTagCommit: LATEST_TAG_COMMIT,
    })
    const pin = parseKernelPin(bumped)
    expect(() => assertLoadableProductPin(pin)).toThrow(/0\.1\.1-rc\.2|loadable/)
  })

  it('rejects schema breaks: version skew, npm-without-publish, wrong track', () => {
    expect(() => parseKernelPin(validPin({ runtimePackageVersion: '0.1.2-alpha.1' }))).toThrow()
    expect(() => parseKernelPin(validPin({ consumption: 'npm', npmPublished: false }))).toThrow()
    expect(() => parseKernelPin(validPin({ track: 'origin/master' }))).toThrow()
    expect(() => parseKernelPin(validPin({ repository: 'https://github.com/anywhere-labs/dsh-desktop.git' }))).toThrow()
  })
})

