import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exportDiagnosticsArchive } from '../src/runtime/diagnostics.ts'
import { applyProfileSelection, applyRecoveryAction, persistLifecycle } from '../src/runtime/recovery-actions.ts'
import { parseRecoveryHref } from '../src/runtime/recovery-href.ts'
import { recordTerminalLaunch } from '../src/runtime/terminal-launch.ts'
import { downloadDesktopUpdate, UpdateDownloadError } from '../src/runtime/update-download.ts'
import { checkForStableUpdate } from '../src/runtime/update-checker.ts'
import {
  folderDropScript,
  loadWindowBounds,
  nextWindowMaximized,
  openExternalHref,
  persistWindowBounds,
  planWindowGeneration,
  shouldHandleTitlebarDblclick,
  shouldOpenExternally,
} from '../src/runtime/window-ops.ts'

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `dsh-${label}-`))
}

describe('Host native product effects', () => {
  it('writes a diagnostics zip under user data', () => {
    const userData = tempDir('diag')
    mkdirSync(join(userData, 'logs'))
    writeFileSync(join(userData, 'logs', 'dsh.log'), 'boot ok')
    const path = exportDiagnosticsArchive(userData, '0.1.0')
    const bytes = readFileSync(path)
    expect(bytes.subarray(0, 4).toString()).toBe('PK\u0003\u0004')
    expect(bytes.toString('utf8')).toContain('system-info.txt')
    expect(bytes.toString('utf8')).toContain('dsh.log')
    expect(bytes.toString('utf8')).toContain('boot ok')
  })

  it('records a terminal launch command for the active profile', () => {
    const userData = tempDir('term')
    const launch = recordTerminalLaunch(userData, 'darwin', {
      profileName: 'desktop',
      profileDir: '/tmp/profile',
      homeDir: '/tmp/home',
    })
    expect(launch.command[0]).toBe('open')
    expect(launch.command).toContain('Terminal')
    const record = readFileSync(launch.recordPath, 'utf8')
    expect(record).toContain('"profileName": "desktop"')
    if (process.platform !== 'win32') {
      expect(lstatSync(launch.scriptPath).mode & 0o777).toBe(0o700)
    }
  })

  it('zooms on titlebar double-click and restores on the next one', () => {
    expect(shouldHandleTitlebarDblclick({
      clientY: 12,
      titlebarHeight: 36,
      interactive: false,
      inTitlebarRegion: true,
    })).toBe(true)
    expect(shouldHandleTitlebarDblclick({
      clientY: 12,
      titlebarHeight: 36,
      interactive: true,
      inTitlebarRegion: true,
    })).toBe(false)
    expect(shouldHandleTitlebarDblclick({
      clientY: 8,
      titlebarHeight: 36,
      interactive: false,
      inTitlebarRegion: false,
    })).toBe(true)
    expect(shouldHandleTitlebarDblclick({
      clientY: 80,
      titlebarHeight: 36,
      interactive: false,
      inTitlebarRegion: false,
    })).toBe(false)
    expect(nextWindowMaximized(false)).toBe(true)
    expect(nextWindowMaximized(true)).toBe(false)
  })

  it('parses update-available vs up-to-date from a fixture body and downloads the installer', async () => {
    const available = await checkForStableUpdate({
      currentVersion: '0.1.0',
      request: async () => new Response(JSON.stringify({ version: '0.2.0' }), { status: 200 }),
    })
    expect(available).toEqual({
      status: 'update-available',
      currentVersion: '0.1.0',
      latestVersion: '0.2.0',
    })
    const current = await checkForStableUpdate({
      currentVersion: '0.2.0',
      request: async () => new Response(JSON.stringify({ version: '0.2.0' }), { status: 200 }),
    })
    expect(current?.status).toBe('up-to-date')
    const userData = tempDir('update')
    const destinationPath = join(userData, 'updates', 'DSH-Desktop-0.2.0.bin')
    const artifact = Buffer.alloc(1024)
    artifact.write('koly', 1024 - 512, 'ascii')
    const saved = await downloadDesktopUpdate({
      platform: 'darwin',
      version: '0.2.0',
      destinationPath,
      request: async () => new Response(artifact, { status: 200 }),
    })
    expect(readFileSync(saved, 'utf8')).toBe(artifact.toString('utf8'))
    await expect(downloadDesktopUpdate({
      platform: 'darwin',
      version: '0.2.0',
      destinationPath: join(userData, 'updates', 'empty.bin'),
      request: async () => new Response(Buffer.alloc(0), { status: 200 }),
    })).rejects.toBeInstanceOf(UpdateDownloadError)
  })

  it('persists recovery and profile-create actions', () => {
    const userData = tempDir('recovery')
    const switched = applyRecoveryAction(userData, parseRecoveryHref('dsh-recovery://switch-profile?name=web')!)
    expect(switched).toEqual({ kind: 'profile', profileName: 'web' })
    expect(readFileSync(join(userData, 'profile-selection', 'state.json'), 'utf8')).toContain('"active": "web"')
    expect(applyProfileSelection(userData, 'desktop')).toBe('desktop')
    expect(applyRecoveryAction(userData, parseRecoveryHref('dsh-recovery://restart')!)).toEqual({ kind: 'restart' })
    expect(readFileSync(join(userData, 'lifecycle.json'), 'utf8')).toContain('"restart"')
    persistLifecycle(userData, 'quit')
    const exported = applyRecoveryAction(userData, parseRecoveryHref('dsh-recovery://save-diagnostics')!)
    expect(exported.kind).toBe('diagnostics')
    if (exported.kind === 'diagnostics') {
      expect(readFileSync(exported.path).subarray(0, 2).toString()).toBe('PK')
    }
  })

  it('plans chrome, drop forwarding, zoom bounds, and external links', () => {
    const linux = planWindowGeneration('linux', 'advanced', 'transparent', 'mica', undefined, 0)
    expect(linux.mode).toBe('compatibility')
    expect(linux.titlebarHeight).toBe(36)
    expect(linux.material).toBe('off')
    const advanced = planWindowGeneration('darwin', 'advanced', 'transparent', 'off', undefined, 9)
    expect(advanced.titlebarHeight).toBe(32)
    expect(advanced.zoomLevel).toBe(4)
    const script = folderDropScript(['/Users/me/proj'], 12, 40)
    expect(script).toContain('dsh-desktop-folder-drop')
    expect(script).toContain('/Users/me/proj')
    expect(shouldOpenExternally('http://127.0.0.1:9/', 'https://example.com')).toBe(true)
    expect(shouldOpenExternally('http://127.0.0.1:9/', 'http://127.0.0.1:9/app')).toBe(false)
    const opened: string[] = []
    expect(openExternalHref('http://127.0.0.1:9/', 'https://example.com', url => { opened.push(url) })).toBe(true)
    expect(opened).toEqual(['https://example.com'])
    expect(openExternalHref('http://127.0.0.1:9/', 'http://127.0.0.1:9/app', () => {
      throw new Error('must not open loopback')
    })).toBe(false)
    const userData = tempDir('bounds')
    persistWindowBounds(userData, { x: 12, y: 24, width: 1280, height: 800 })
    expect(loadWindowBounds(userData)).toEqual({ x: 12, y: 24, width: 1280, height: 800 })
  })
})
