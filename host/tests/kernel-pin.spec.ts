import { describe, expect, it } from 'vitest'
import {
  LOADABLE_KERNEL_COMMIT,
  LOADABLE_KERNEL_TAG,
  LOADABLE_KERNEL_VERSION,
  assertLoadableProductPin,
  parseKernelPin,
} from '../src/runtime/kernel-pin.ts'

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

describe('kernel-pin schema', () => {
  // 本仓库不再保留 docs/kernel-pin.json（壳不锁定 DSH 版本），只留 schema 拒绝逻辑的断言
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

