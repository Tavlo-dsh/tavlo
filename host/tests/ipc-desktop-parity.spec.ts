import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NATIVE_METHODS } from '../src/rpc/protocol.ts'
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
    iconPath: '',
    trayIcons: { templatePath: '', bluePath: '' },
    locale: 'en',
    themeSource: 'system',
  }
}

interface Recorded {
  readonly method: string
  readonly params: unknown
}

function recordingTransport(
  handlers: Record<string, (params: unknown) => unknown> = {},
): { transport: LoopbackRpcTransport, calls: Recorded[] } {
  const calls: Recorded[] = []
  const transport = new LoopbackRpcTransport(async (method, params) => {
    calls.push({ method, params })
    return handlers[method]?.(params) ?? {}
  })
  return { transport, calls }
}

function dialogCall(calls: readonly Recorded[]): Record<string, unknown> {
  const call = calls.find(item => item.method === NATIVE_METHODS.openDialog)
  expect(call).toBeDefined()
  return (call?.params ?? {}) as Record<string, unknown>
}

function callsTo(calls: readonly Recorded[], method: string): Recorded[] {
  return calls.filter(call => call.method === method)
}

const flush = async (): Promise<void> => {
  await new Promise(resolve => setImmediate(resolve))
}

describe('restart confirmation (gap 6)', () => {
  it('asks with the original English copy and restarts only on confirm', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.requestRestart()
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('question')
    expect(dialog.title).toBe('Restart DSH Desktop')
    expect(dialog.message).toBe('Restart DSH Desktop now?')
    expect(dialog.detail).toBe('Running operations and unsent input may be interrupted. Saved settings will not be lost.')
    expect(dialog.buttons).toEqual(['Restart', 'Cancel'])
    expect(dialog.defaultId).toBe(1)
    expect(dialog.cancelId).toBe(1)
    expect(callsTo(calls, NATIVE_METHODS.restart)).toHaveLength(1)
    runtime.dispose()
  })

  it('does not restart when cancelled', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 1 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.requestRestart()
    expect(callsTo(calls, NATIVE_METHODS.restart)).toHaveLength(0)
    runtime.dispose()
  })

  it('uses the recovery copy and restartRecovery for recovery restarts', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.requestRecoveryRestart()
    const dialog = dialogCall(calls)
    expect(dialog.title).toBe('Restart in Recovery Mode')
    expect(dialog.message).toBe('Restart DSH Desktop in Recovery Mode?')
    expect(dialog.detail).toBe('The next launch opens the recovery assistant before the Profile and plugin Host start. Running operations and unsent input may be interrupted.')
    expect(dialog.buttons).toEqual(['Restart in Recovery Mode', 'Cancel'])
    expect(callsTo(calls, NATIVE_METHODS.restartRecovery)).toHaveLength(1)
    expect(callsTo(calls, NATIVE_METHODS.restart)).toHaveLength(0)
    runtime.dispose()
  })

  it('uses the Chinese copy after a zh locale preference', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 1 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.setLocalePreference('zh')
    await runtime.requestRestart()
    const dialog = dialogCall(calls)
    expect(dialog.title).toBe('重启 DSH Desktop')
    expect(dialog.buttons).toEqual(['重启', '取消'])
    runtime.dispose()
  })

  it('shares one confirmation across concurrent requests', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await Promise.all([runtime.requestRestart(), runtime.requestRestart()])
    expect(callsTo(calls, NATIVE_METHODS.openDialog)).toHaveLength(1)
    expect(callsTo(calls, NATIVE_METHODS.restart)).toHaveLength(1)
    runtime.dispose()
  })

  it('is a no-op once quitting is prepared', async () => {
    const { transport, calls } = recordingTransport()
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.prepareToQuit()
    await runtime.requestRestart()
    expect(callsTo(calls, NATIVE_METHODS.openDialog)).toHaveLength(0)
    expect(callsTo(calls, NATIVE_METHODS.restart)).toHaveLength(0)
    runtime.dispose()
  })
})

describe('diagnostics export (gap 5)', () => {
  const diagnosticsPath = '/tmp/exports/dsh-diagnostics-1.zip'

  it('confirms with the privacy copy, exports, and reveals the archive', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
      [NATIVE_METHODS.exportDiagnostics]: () => ({ ok: true, path: diagnosticsPath }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.exportDiagnostics()
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('warning')
    expect(dialog.title).toBe('Export Diagnostics')
    expect(dialog.message).toBe('Review the diagnostic archive before sharing it.')
    expect(String(dialog.detail)).toContain('Crash dumps may contain fragments of process memory.')
    expect(dialog.buttons).toEqual(['Export', 'Cancel'])
    expect(dialog.defaultId).toBe(1)
    expect(dialog.cancelId).toBe(1)
    expect(callsTo(calls, NATIVE_METHODS.exportDiagnostics)).toHaveLength(1)
    const reveal = callsTo(calls, NATIVE_METHODS.revealItem)
    expect(reveal).toHaveLength(1)
    expect((reveal[0]?.params as { path?: string }).path).toBe(diagnosticsPath)
    runtime.dispose()
  })

  it('does not export when cancelled', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 1 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.exportDiagnostics()
    expect(callsTo(calls, NATIVE_METHODS.exportDiagnostics)).toHaveLength(0)
    runtime.dispose()
  })

  it('shows the localized error dialog when the export fails', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
      [NATIVE_METHODS.exportDiagnostics]: () => {
        throw new Error('disk full')
      },
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.exportDiagnostics()
    const dialogs = callsTo(calls, NATIVE_METHODS.openDialog).map(call => call.params as Record<string, unknown>)
    expect(dialogs).toHaveLength(2)
    expect(dialogs[1]?.type).toBe('error')
    expect(dialogs[1]?.title).toBe('Unable to Export Diagnostics')
    expect(dialogs[1]?.message).toBe('DSH Desktop could not export the diagnostic archive.')
    expect(dialogs[1]?.detail).toBe('disk full')
    expect(dialogs[1]?.buttons).toEqual(['OK'])
    runtime.dispose()
  })

  it('uses the Chinese error copy in zh', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
      [NATIVE_METHODS.exportDiagnostics]: () => {
        throw new Error('boom')
      },
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.setLocalePreference('zh')
    await runtime.exportDiagnostics()
    const dialogs = callsTo(calls, NATIVE_METHODS.openDialog).map(call => call.params as Record<string, unknown>)
    expect(dialogs[0]?.title).toBe('导出诊断信息')
    expect(dialogs[1]?.title).toBe('无法导出诊断信息')
    expect(dialogs[1]?.buttons).toEqual(['确定'])
    runtime.dispose()
  })

  it('merges concurrent exports into one task', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
      [NATIVE_METHODS.exportDiagnostics]: () => ({ ok: true, path: diagnosticsPath }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await Promise.all([runtime.exportDiagnostics(), runtime.exportDiagnostics()])
    expect(callsTo(calls, NATIVE_METHODS.exportDiagnostics)).toHaveLength(1)
    runtime.dispose()
  })
})

describe('renderer boot health fallback dialog (gap 12)', () => {
  it('shows the plugin recovery dialog when a failed report arrives with no active gate', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 2 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.reportRendererBoot({ status: 'failed', plugins: ['dsh-market'], error: 'loader exploded' })
    await flush()
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('error')
    expect(dialog.title).toBe('Plugin Load Failed')
    expect(dialog.message).toBe('Some plugins could not be loaded.')
    expect(dialog.detail).toBe(
      'Plugins that failed to load:\n- dsh-market\n\nloader exploded\n\n'
      + 'Open DSH Terminal to update or remove the failing third-party plugin, then restart DSH Desktop.',
    )
    expect(dialog.buttons).toEqual(['Open DSH Terminal', 'Restart DSH Desktop', 'Dismiss'])
    expect(dialog.defaultId).toBe(0)
    expect(dialog.cancelId).toBe(2)
    runtime.dispose()
  })

  it('opens the terminal when the dialog is confirmed and a terminal profile exists', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-renderer-term-'))
    const runtime = new IpcDesktopRuntime(transport, {
      platform: 'darwin',
      userDataDir,
      terminalRuntime: {
        nodeExecutable: process.execPath,
        dshBootstrapPath: join(userDataDir, 'cli.js'),
        pnpmBinPath: join(userDataDir, 'pnpm.mjs'),
        nodeVersion: process.versions.node,
        productVersion: '1.0.0',
      },
    })
    runtime.configureTerminal({ profileName: 'desktop', profileDir: '/tmp/profile', homeDir: '/tmp/home' })
    runtime.reportRendererBoot({ status: 'failed', plugins: [] })
    await flush()
    await flush()
    expect(callsTo(calls, NATIVE_METHODS.openTerminal)).toHaveLength(1)
    runtime.dispose()
  })

  it('substitutes localized placeholders for empty plugins and missing errors in zh', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 2 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.setLocalePreference('zh')
    runtime.reportRendererBoot({ status: 'failed', plugins: [] })
    await flush()
    const dialog = dialogCall(calls)
    expect(dialog.title).toBe('插件加载失败')
    expect(String(dialog.detail)).toContain('未知客户端插件')
    expect(String(dialog.detail)).toContain('插件加载器没有提供错误信息。')
    runtime.dispose()
  })

  it('does not show the dialog while a gate is monitoring', async () => {
    const { transport, calls } = recordingTransport()
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    const verdict = runtime.beginRendererBootMonitoring({ commitHealthy: async () => undefined }, 60_000)
    runtime.reportRendererBoot({ status: 'failed', plugins: ['a'], error: 'boom' })
    const settled = await verdict
    if (!('failureReason' in settled)) throw new Error('expected the gate to fail')
    expect(settled.failureReason).toBe('renderer-failed')
    await flush()
    expect(callsTo(calls, NATIVE_METHODS.openDialog)).toHaveLength(0)
    runtime.dispose()
  })

  it('keeps a healthy verdict free of dialogs and commits once', async () => {
    const { transport, calls } = recordingTransport()
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    const commits: number[] = []
    const verdict = runtime.beginRendererBootMonitoring(
      { commitHealthy: async () => { commits.push(1) } },
      60_000,
    )
    runtime.schedule(payload())
    runtime.reportRendererBoot({ status: 'healthy' })
    await runtime.mountScheduled()
    const settled = await verdict
    if ('failureReason' in settled) throw new Error('expected the gate to commit healthy')
    expect(settled.report.status).toBe('healthy')
    expect(commits).toHaveLength(1)
    expect(callsTo(calls, NATIVE_METHODS.openDialog)).toHaveLength(0)
    runtime.dispose()
  })
})

describe('locale fallback (gap 13)', () => {
  it('falls back to the system language tag when the preference is undefined', () => {
    const { transport, calls } = recordingTransport()
    const runtime = new IpcDesktopRuntime(transport, {
      platform: 'darwin',
      systemLocaleTag: () => 'zh-CN',
    })
    runtime.setLocalePreference(undefined)
    expect(callsTo(calls, NATIVE_METHODS.setLocale).map(call => (call.params as { locale: string }).locale))
      .toEqual(['zh'])
    runtime.dispose()
  })

  it('keeps the current locale when the fallback resolves to it', () => {
    const { transport, calls } = recordingTransport()
    const runtime = new IpcDesktopRuntime(transport, {
      platform: 'darwin',
      locale: 'zh',
      systemLocaleTag: () => 'zh-CN',
    })
    runtime.setLocalePreference(undefined)
    expect(callsTo(calls, NATIVE_METHODS.setLocale)).toHaveLength(0)
    runtime.dispose()
  })
})

describe('terminal launch failure dialog (gap 1)', () => {
  it('opens the localized error dialog when terminal preparation fails', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-term-fail-'))
    const runtime = new IpcDesktopRuntime(transport, { platform: 'linux', userDataDir })
    runtime.configureTerminal({ profileName: 'desktop', profileDir: '/tmp/profile', homeDir: '/tmp/home' })
    runtime.openTerminal()
    await flush()
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('error')
    expect(dialog.title).toBe('Unable to Open DSH Terminal')
    expect(dialog.message).toBe('DSH Desktop could not open a terminal.')
    expect(String(dialog.detail)).toContain('linux')
    expect(dialog.buttons).toEqual(['OK'])
    expect(dialog.defaultId).toBe(0)
    expect(dialog.cancelId).toBe(0)
    runtime.dispose()
  })
})

describe('update dialogs (gap 9)', () => {
  it('confirms downloads with the original copy', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.updates.confirmDownload('1.2.0')
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('info')
    expect(dialog.title).toBe('DSH Desktop Update Available')
    expect(dialog.message).toBe('DSH Desktop 1.2.0 is available.')
    expect(dialog.detail).toBe('Download this update now?')
    expect(dialog.buttons).toEqual(['Download', 'Later'])
    expect(dialog.defaultId).toBe(1)
    expect(dialog.cancelId).toBe(1)
    runtime.dispose()
  })

  it('shows the manual check failure dialog', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await runtime.updates.showManualCheckResult(null)
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('warning')
    expect(dialog.title).toBe('Unable to Check for Updates')
    expect(dialog.message).toBe('DSH Desktop could not check for updates.')
    expect(dialog.detail).toBe('Please try again later.')
    expect(dialog.buttons).toEqual(['OK'])
    runtime.dispose()
  })

  it('shows the up-to-date dialog with the installed version', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin', currentVersion: '0.1.0' })
    await runtime.updates.showManualCheckResult({
      status: 'up-to-date',
      currentVersion: '0.1.0',
      latestVersion: '0.1.0',
    })
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('info')
    expect(dialog.title).toBe('DSH Desktop Is Up to Date')
    expect(dialog.detail).toBe('Installed version: 0.1.0')
    runtime.dispose()
  })

  it('explains when an update exists but downloads are unavailable', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'linux' })
    await runtime.updates.showManualCheckResult({
      status: 'update-available',
      currentVersion: '0.1.0',
      latestVersion: '1.2.0',
    })
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('info')
    expect(dialog.title).toBe('DSH Desktop Is Up to Date')
    expect(dialog.detail).toBe('Installer downloads are unavailable in this build.')
    runtime.dispose()
  })

  it('asks where to save before downloading and opens the artifact afterwards', async () => {
    const artifact = Buffer.alloc(1024)
    artifact.write('koly', 1024 - 512, 'ascii')
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.saveDialog]: () => ({ path: '/tmp/DSH-Desktop-1.2.0-mac.dmg' }),
      [NATIVE_METHODS.openUpdate]: () => ({ ok: true }),
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, {
      platform: 'darwin',
      isPackaged: true,
      updatesRequest: async () => new Response(new Uint8Array(artifact)),
    })
    const controller = new AbortController()
    await runtime.updates.downloadAndOpen('1.2.0', controller.signal)
    const save = callsTo(calls, NATIVE_METHODS.saveDialog).map(call => call.params as Record<string, unknown>)
    expect(save).toHaveLength(1)
    expect(save[0]?.title).toBe('Save Update Installer')
    expect(save[0]?.defaultPath).toBe('DSH-Desktop-1.2.0-mac.dmg')
    const opened = callsTo(calls, NATIVE_METHODS.openUpdate).map(call => call.params as Record<string, unknown>)
    expect(opened).toHaveLength(1)
    expect(opened[0]?.path).toBe('/tmp/DSH-Desktop-1.2.0-mac.dmg')
    runtime.dispose()
  })

  it('aborts quietly when the save dialog is cancelled', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.saveDialog]: () => ({ path: null }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin', isPackaged: true })
    await runtime.updates.downloadAndOpen('1.2.0', new AbortController().signal)
    expect(callsTo(calls, NATIVE_METHODS.openUpdate)).toHaveLength(0)
    runtime.dispose()
  })
})

describe('workspace admission (gap 10)', () => {
  it('passes the localized picker title to the native directory picker', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.pickDirectory]: () => ({ path: '/Users/me/proj' }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await expect(runtime.pickDirectory()).resolves.toBe('/Users/me/proj')
    expect(callsTo(calls, NATIVE_METHODS.pickDirectory)[0]?.params).toEqual({
      title: 'Select Workspace Directory',
    })
    runtime.dispose()
  })

  it('returns null when the native picker is cancelled', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.pickDirectory]: () => ({ path: null }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    await expect(runtime.pickDirectory()).resolves.toBe(null)
    expect(callsTo(calls, NATIVE_METHODS.openDialog)).toHaveLength(0)
    runtime.dispose()
  })

  it('admits volumes the native shell marks allowed without a dialog', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.validateDirectory]: () => ({ decision: 'allow' }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'win32' })
    await expect(runtime.validateDirectory('C:\\work')).resolves.toBe(true)
    expect(callsTo(calls, NATIVE_METHODS.openDialog)).toHaveLength(0)
    runtime.dispose()
  })

  it('confirms removable NTFS workspaces before admitting them', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.validateDirectory]: () => ({ decision: 'confirm', fileSystem: 'NTFS' }),
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'win32' })
    await expect(runtime.validateDirectory('E:\\work')).resolves.toBe(true)
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('warning')
    expect(dialog.title).toBe('Removable Workspace')
    expect(dialog.buttons).toEqual(['Use This Folder', 'Choose Another Folder'])
    expect(dialog.defaultId).toBe(1)
    runtime.dispose()
  })

  it('rejects a removable workspace when the confirmation is declined', async () => {
    const { transport } = recordingTransport({
      [NATIVE_METHODS.validateDirectory]: () => ({ decision: 'confirm', fileSystem: 'NTFS' }),
      [NATIVE_METHODS.openDialog]: () => ({ response: 1 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'win32' })
    await expect(runtime.validateDirectory('E:\\work')).resolves.toBe(false)
    runtime.dispose()
  })

  it('blocks unsupported filesystems with an error dialog', async () => {
    const { transport, calls } = recordingTransport({
      [NATIVE_METHODS.validateDirectory]: () => ({ decision: 'block', fileSystem: 'exFAT' }),
      [NATIVE_METHODS.openDialog]: () => ({ response: 0 }),
    })
    const runtime = new IpcDesktopRuntime(transport, { platform: 'win32' })
    await expect(runtime.validateDirectory('F:\\work')).resolves.toBe(false)
    const dialog = dialogCall(calls)
    expect(dialog.type).toBe('error')
    expect(dialog.title).toBe('Unsupported Workspace Storage')
    expect(dialog.message).toBe('exFAT cannot safely host a DSH Desktop workspace.')
    expect(dialog.buttons).toEqual(['Choose Another Folder'])
    runtime.dispose()
  })
})
