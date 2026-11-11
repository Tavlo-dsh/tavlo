import { lstatSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NATIVE_EVENTS, NATIVE_METHODS } from '../src/rpc/protocol.ts'
import { LoopbackRpcTransport } from '../src/rpc/transport.ts'
import { IpcDesktopRuntime } from '../src/runtime/ipc-desktop-runtime.ts'
import type { DesktopShellPayload } from '../src/runtime/types.ts'

function payload(url = 'http://127.0.0.1:9/'): DesktopShellPayload {
  return {
    mode: 'compatibility',
    macosMaterial: 'transparent',
    windowsMaterial: 'off',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    material: 'transparent',
    url,
    productName: 'DSH Desktop',
    windowTitle: 'DSH Desktop',
    iconPath: '/tmp/icon.png',
    trayIcons: { templatePath: '/tmp/t.png', bluePath: '/tmp/b.png' },
    locale: 'en',
    themeSource: 'system',
  }
}

describe('IpcDesktopRuntime generation lifecycle', () => {
  it('schedules, mounts, then releases exactly one generation', async () => {
    const calls: string[] = []
    const transport = new LoopbackRpcTransport(async (method, params) => {
      calls.push(method)
      if (method === NATIVE_METHODS.schedule) return { generationId: 'g1' }
      if (method === NATIVE_METHODS.mount) {
        expect(params).toEqual({ generationId: 'g1' })
        return { ok: true }
      }
      if (method === NATIVE_METHODS.release) {
        expect(params).toEqual({ generationId: 'g1' })
        return { ok: true }
      }
      return {}
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    const release = runtime.schedule(payload())
    let interactive = false
    await runtime.mountScheduled(() => { interactive = true })
    expect(interactive).toBe(true)
    await release()
    expect(calls).toEqual([NATIVE_METHODS.schedule, NATIVE_METHODS.mount, NATIVE_METHODS.release])
    runtime.dispose()
  })

  it('serializes DesktopShellSpec functions into native schedule params', async () => {
    const urls: unknown[] = []
    const transport = new LoopbackRpcTransport(async (method, params) => {
      if (method === NATIVE_METHODS.schedule) {
        urls.push((params as { url?: string }).url)
        return { generationId: 'g-spec' }
      }
      return { ok: true }
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.schedule({
      ...payload('http://127.0.0.1:4242/'),
      rendererAccessHeader: { name: 'x-dsh-desktop-renderer', value: 'A'.repeat(43) },
      readLocalePreference: () => 'zh',
      readThemeSource: () => 'dark',
      requestQuit: () => undefined,
      requestModeChange: async () => undefined,
    })
    await runtime.mountScheduled()
    expect(urls).toEqual(['http://127.0.0.1:4242/'])
    runtime.dispose()
  })

  it('forwards the generation renderer access header to the native shell', async () => {
    const headers: unknown[] = []
    const transport = new LoopbackRpcTransport(async (method, params) => {
      if (method === NATIVE_METHODS.schedule) {
        headers.push((params as { rendererAccessHeader?: unknown }).rendererAccessHeader)
        expect('rendererAccessHeader' in (params as object)).toBe(true)
        return { generationId: 'g-header' }
      }
      return { ok: true }
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    const header = { name: 'x-dsh-desktop-renderer', value: 'b'.repeat(43) } as const
    runtime.schedule({
      ...payload('http://127.0.0.1:4242/'),
      rendererAccessHeader: header,
      readLocalePreference: () => 'en',
      readThemeSource: () => 'system',
      requestQuit: () => undefined,
      requestModeChange: async () => undefined,
    })
    await runtime.mountScheduled()
    expect(headers).toEqual([header])
    runtime.dispose()
  })

  it('omits rendererAccessHeader when the scheduled payload carries none', async () => {
    const paramsSeen: object[] = []
    const transport = new LoopbackRpcTransport(async (method, params) => {
      if (method === NATIVE_METHODS.schedule) {
        paramsSeen.push((params ?? {}) as object)
        return { generationId: 'g-plain' }
      }
      return { ok: true }
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.schedule(payload())
    await runtime.mountScheduled()
    expect('rendererAccessHeader' in paramsSeen[0]!).toBe(false)
    runtime.dispose()
  })

  it('rejects a second schedule while a generation is live', () => {
    const transport = new LoopbackRpcTransport(async () => ({ generationId: 'g1' }))
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.schedule(payload())
    expect(() => runtime.schedule(payload())).toThrow('already registered')
    runtime.dispose()
  })

  it('invokes a tray item when the native shell emits trayInvoke', async () => {
    const invoked: string[] = []
    const transport = new LoopbackRpcTransport(async () => ({}))
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.registerTrayItem({
      group: 'tools',
      order: 1,
      label: () => 'Open Terminal',
      invoke: () => { invoked.push('terminal') },
    })
    transport.emit(NATIVE_EVENTS.trayInvoke, { id: 'tray-1' })
    await Promise.resolve()
    expect(invoked).toEqual(['terminal'])
    runtime.dispose()
  })

  it('prepares an executable welcome.command before asking native to open Terminal', async () => {
    const calls: Array<{ method: string, params: Record<string, unknown> }> = []
    const transport = new LoopbackRpcTransport(async (method, params) => {
      calls.push({ method, params: (params ?? {}) as Record<string, unknown> })
      return { ok: true }
    })
    const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-runtime-term-'))
    const runtime = new IpcDesktopRuntime(transport, {
      platform: 'darwin',
      userDataDir,
      currentVersion: '2.0.0',
      terminalRuntime: {
        nodeExecutable: process.execPath,
        dshBootstrapPath: join(userDataDir, 'desktop-cli.js'),
        pnpmBinPath: join(userDataDir, 'pnpm.mjs'),
        nodeVersion: process.versions.node,
        productVersion: '2.0.0',
      },
    })
    runtime.configureTerminal({
      profileName: 'desktop',
      profileDir: '/tmp/profile',
      homeDir: '/tmp/home',
    })
    runtime.openTerminal()
    await new Promise(resolve => setImmediate(resolve))
    const opened = calls.find(call => call.method === NATIVE_METHODS.openTerminal)
    expect(opened).toBeDefined()
    const scriptPath = opened?.params.scriptPath
    expect(typeof scriptPath).toBe('string')
    expect(String(scriptPath).endsWith('welcome.command')).toBe(true)
    expect(opened?.params.command).toEqual(['open', '-a', 'Terminal', scriptPath])
    if (process.platform !== 'win32') {
      expect(lstatSync(String(scriptPath)).mode & 0o777).toBe(0o700)
    }
    runtime.dispose()
  })
})
