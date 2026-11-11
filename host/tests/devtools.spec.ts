import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isDevToolsEnabled, resolveCompiledDevTools } from '../src/runtime/build-profile.ts'
import { LogJournal } from '../src/runtime/log-journal.ts'
import { NetworkJournal } from '../src/runtime/network-journal.ts'
import { writeListenManifest } from '../src/runtime/listen-manifest.ts'
import { startLoopbackCarrier } from '../src/host/loopback.ts'

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...values }
}

describe('developer tools build profile', () => {
  it('is on for a local package and off for GitHub Actions or an explicit production profile', () => {
    expect(resolveCompiledDevTools(env({}))).toBe(true)
    expect(resolveCompiledDevTools(env({ GITHUB_ACTIONS: 'true' }))).toBe(false)
    expect(resolveCompiledDevTools(env({ DSH_PROFILE: 'production' }))).toBe(false)
    expect(resolveCompiledDevTools(env({ GITHUB_ACTIONS: 'true', DSH_DEV_TOOLS: '1' }))).toBe(true)
    expect(isDevToolsEnabled(env({ DSH_DEV_TOOLS: '0' }), true)).toBe(false)
    expect(isDevToolsEnabled(env({ DSH_DEV_TOOLS: '1' }), false)).toBe(true)
  })
})

describe('log and network journals', () => {
  it('is a no-op when developer tools are disabled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-dev-off-'))
    const logs = new LogJournal(dir, false)
    const network = new NetworkJournal(dir, false)
    expect(logs.append({ level: 'info', source: 'host', message: 'boot' })).toBeUndefined()
    expect(network.append({ method: 'GET', url: 'http://127.0.0.1/health', status: 200 })).toBeUndefined()
    expect(existsSync(logs.filePath)).toBe(false)
    expect(existsSync(network.filePath)).toBe(false)
  })

  it('writes queryable NDJSON that an AI tool can tail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-dev-on-'))
    const logs = new LogJournal(dir, true)
    logs.append({ level: 'info', source: 'host', message: 'loopback bound' })
    logs.append({ level: 'error', source: 'rpc', message: 'native shell.tray.upsert failed' })
    expect(logs.query({ q: 'tray', level: 'warn' }).map(item => item.message)).toEqual([
      'native shell.tray.upsert failed',
    ])
    const file = readFileSync(logs.filePath, 'utf8')
    expect(file).toContain('"source":"host"')
    expect(file.trim().split('\n')).toHaveLength(2)

    const network = new NetworkJournal(dir, true)
    network.append({ method: 'GET', url: 'http://127.0.0.1:9/health', status: 200, durationMs: 3 })
    network.append({ method: 'POST', url: 'https://www.dshdesktop.cn/api/desktop/version', status: 200 })
    expect(network.query({ q: 'dshdesktop', method: 'POST' })).toHaveLength(1)
    expect(readFileSync(network.filePath, 'utf8')).toContain('dshdesktop.cn')
  })

  it('records wrapped fetch calls', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-fetch-'))
    const network = new NetworkJournal(dir, true)
    const fetchImpl = network.wrapFetch(async () => new Response('ok', { status: 201 }))
    const response = await fetchImpl('https://example.com/api')
    expect(response.status).toBe(201)
    expect(network.query({ q: 'example.com' })[0]?.status).toBe(201)
  })
})

describe('devtools HTTP surface', () => {
  it('exposes log and network tables only when enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-http-dev-'))
    const logs = new LogJournal(dir, true)
    const network = new NetworkJournal(dir, true)
    logs.append({ level: 'info', source: 'host', message: 'ready' })
    const carrier = await startLoopbackCarrier({
      pageTitle: 'DSH Desktop',
      devtools: { enabled: true, logs, network },
    })
    writeListenManifest(dir, {
      version: 1,
      enabled: true,
      logsPath: logs.filePath,
      networkPath: network.filePath,
      http: {
        origin: carrier.origin,
        logs: `${carrier.origin}/_dsh/dev/logs`,
        network: `${carrier.origin}/_dsh/dev/network`,
        ui: `${carrier.origin}/_dsh/dev/ui`,
        meta: `${carrier.origin}/_dsh/dev/meta`,
      },
    })
    const meta = await (await fetch(`${carrier.origin}/_dsh/dev/meta`)).json() as { enabled: boolean }
    expect(meta.enabled).toBe(true)
    const table = await (await fetch(`${carrier.origin}/_dsh/dev/logs?q=ready`)).json() as { records: { message: string }[] }
    expect(table.records[0]?.message).toBe('ready')
    const page = await (await fetch(`${carrier.origin}/_dsh/dev/ui`)).text()
    expect(page).toContain('data-devtools-tab')
    await carrier.close()
  })

  it('hides the inspector routes when developer tools are off', async () => {
    const carrier = await startLoopbackCarrier({ pageTitle: 'DSH Desktop', devtools: { enabled: false } })
    expect((await fetch(`${carrier.origin}/_dsh/dev/logs`)).status).toBe(404)
    expect((await fetch(`${carrier.origin}/_dsh/dev/ui`)).status).toBe(404)
    await carrier.close()
  })
})
