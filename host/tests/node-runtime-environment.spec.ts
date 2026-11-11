import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertShimUsesRealNode,
  installDesktopNodeRuntime,
  posixNodeShim,
  posixPnpmShim,
  windowsPnpmShim,
} from '../src/runtime/node-runtime-environment.ts'

describe('Node Host command shims', () => {
  it('never target Electron ABI or ELECTRON_RUN_AS_NODE', () => {
    const posix = posixPnpmShim({
      nodeExecutable: '/usr/bin/node',
      pnpmBinPath: '/opt/pnpm.mjs',
      nodeVersion: '22.20.0',
    }, '/tmp/node-bin', '/tmp/node-bin/node')
    const windows = windowsPnpmShim({
      nodeExecutable: 'C:\\node\\node.exe',
      pnpmBinPath: 'C:\\pnpm\\pnpm.mjs',
      nodeVersion: '22.20.0',
    }, 'C:\\node-bin', 'C:\\node-bin\\node.cmd')
    assertShimUsesRealNode(posix)
    assertShimUsesRealNode(windows)
    expect(posix).toContain('npm_config_runtime=node')
    expect(windows).toContain('npm_config_runtime=node')
    expect(posix).toContain('/usr/bin/node')
    expect(windows).toContain('C:\\node\\node.exe')
    expect(posix).toContain('--config.minimumReleaseAge=0')
    expect(windows).toContain('--config.minimumReleaseAge=0')
  })

  it('shims exec bun when that is the Host JS runtime', () => {
    const bun = "/Users/me/.bun/bin/bun"
    const posix = posixPnpmShim({
      nodeExecutable: bun,
      pnpmBinPath: '/opt/pnpm.mjs',
      nodeVersion: '22.6.0',
    }, '/tmp/node-bin', '/tmp/node-bin/node')
    expect(posix).toContain(`exec '${bun}' '/opt/pnpm.mjs'`)
    expect(posix).toContain('npm_config_runtime=node')
    expect(posixNodeShim(bun)).toContain(`exec '${bun}' "$@"`)
  })

  it('installs a public pnpm shim on PATH', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'dsh-host-runtime-'))
    const environment: NodeJS.ProcessEnv = { PATH: '/usr/bin' }
    const installed = installDesktopNodeRuntime({
      platform: 'darwin',
      nodeExecutable: process.execPath,
      pnpmBinPath: '/opt/pnpm/bin/pnpm.mjs',
      nodeVersion: process.versions.node,
      stateDir,
      environment,
    })
    expect(environment.PATH?.startsWith(installed.pathDir)).toBe(true)
    expect(installed.nodeBinDir.length).toBeGreaterThan(0)
    expect(installed.clearEnvironmentPath.endsWith('clear-env.mjs')).toBe(true)
    const shim = readFileSync(installed.pnpmShimPath, 'utf8')
    expect(shim).not.toMatch(/ELECTRON_RUN_AS_NODE/)
    expect(shim).not.toMatch(/npm_config_runtime=electron/)
    installed.dispose()
  })
})
