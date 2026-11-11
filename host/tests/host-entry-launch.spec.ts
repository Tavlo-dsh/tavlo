import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeMessage, encodeMessage, NATIVE_METHODS, PROTOCOL_VERSION } from '../src/rpc/protocol.ts'

const entry = join(dirname(fileURLToPath(import.meta.url)), '../dist/main.js')

type HostLaunch = {
  methods: string[]
  url: string
  status: number
  html: string
}

function bunExecutable(): string | undefined {
  const home = process.env.HOME
  const candidates = [
    home === undefined ? undefined : join(home, '.bun/bin/bun'),
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
  ]
  return candidates.find(candidate => candidate !== undefined && existsSync(candidate))
}

function launchCompiledHost(userDataDir: string, runtime = process.execPath, runtimeArgs: string[] = []): Promise<HostLaunch> {
  return new Promise((resolve, reject) => {
    if (!existsSync(entry)) {
      reject(new Error(`compiled Host entry missing: ${entry}`))
      return
    }
    mkdirSync(userDataDir, { recursive: true })
    const child = spawn(runtime, [...runtimeArgs, entry], {
      env: { ...process.env, DSH_DESKTOP_USER_DATA: userDataDir, DSH_OFFICIAL_HOST: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const methods: string[] = []
    let url = ''
    let buffer = ''
    let completing = false
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      if (!settled) {
        settled = true
        reject(new Error(`Host launch timed out; methods=${methods.join(',')}`))
      }
    }, 8_000)
    const finish = (error?: Error, value?: HostLaunch) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      if (error) reject(error)
      else if (value) resolve(value)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        try {
          const message = decodeMessage(line)
          if (message.type === 'req') {
            methods.push(message.method)
            if (message.method === NATIVE_METHODS.schedule) {
              const params = message.params as { url?: string } | undefined
              url = params?.url ?? ''
              child.stdin.write(encodeMessage({
                v: PROTOCOL_VERSION,
                type: 'res',
                id: message.id,
                result: { generationId: 'g-launch' },
              }))
            } else if (message.method === NATIVE_METHODS.mount) {
              child.stdin.write(encodeMessage({
                v: PROTOCOL_VERSION,
                type: 'res',
                id: message.id,
                result: { ok: true },
              }))
            } else {
              child.stdin.write(encodeMessage({
                v: PROTOCOL_VERSION,
                type: 'res',
                id: message.id,
                result: { ok: true },
              }))
            }
            if (
              !completing
              && methods.includes(NATIVE_METHODS.schedule)
              && methods.includes(NATIVE_METHODS.mount)
              && url.startsWith('http://127.0.0.1:')
            ) {
              completing = true
              void fetch(url).then(async response => {
                const html = await response.text()
                finish(undefined, { methods, url, status: response.status, html })
              }).catch(error => {
                finish(error instanceof Error ? error : new Error(String(error)))
              })
            }
          }
        } catch {
          // ignore non-RPC stderr mixed lines; stdout is RPC-only
        }
        newline = buffer.indexOf('\n')
      }
    })
    child.once('error', error => {
      finish(error)
    })
  })
}

describe('compiled Host entry', () => {
  it('emits schedule with a loopback url then mount, twice', async () => {
    const first = await launchCompiledHost(mkdtempSync(join(tmpdir(), 'dsh-launch-1-')))
    const second = await launchCompiledHost(mkdtempSync(join(tmpdir(), 'dsh-launch-2-')))
    expect(first.url.startsWith('http://127.0.0.1:')).toBe(true)
    expect(second.url.startsWith('http://127.0.0.1:')).toBe(true)
    expect(first.methods).toContain(NATIVE_METHODS.schedule)
    expect(first.methods).toContain(NATIVE_METHODS.mount)
    expect(second.methods).toContain(NATIVE_METHODS.schedule)
    expect(second.methods).toContain(NATIVE_METHODS.mount)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(first.html).toContain('data-tauri-drag-region')
    expect(second.html).toContain('data-tauri-drag-region')
  })

  const bun = bunExecutable()
  it.skipIf(bun === undefined)('emits schedule and mount under bun', async () => {
    const launched = await launchCompiledHost(
      mkdtempSync(join(tmpdir(), 'dsh-launch-bun-')),
      bun as string,
      ['--bun', '--no-env-file', '--no-install'],
    )
    expect(launched.url.startsWith('http://127.0.0.1:')).toBe(true)
    expect(launched.methods).toContain(NATIVE_METHODS.schedule)
    expect(launched.methods).toContain(NATIVE_METHODS.mount)
    expect(launched.status).toBe(200)
    expect(launched.html).toContain('data-tauri-drag-region')
  })
})
