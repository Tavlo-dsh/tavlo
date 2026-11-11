import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Rebuild the injected rewrite script from its Rust home (single source of
 * truth): extract the format-string literal, unescape the `{{`/`}}` escapes,
 * and substitute the three runtime interpolations exactly as `format!` would.
 */
function buildScript(carrierAuthority: string, proxyAuthority: string, secret: string): string {
  const rust = readFileSync(join(repoRoot, 'src-tauri/src/renderer_proxy.rs'), 'utf8')
  const fnStart = rust.indexOf('pub fn origin_rewrite_script')
  const literalStart = rust.indexOf('r#"', fnStart)
  const literalEnd = literalStart < 0 ? -1 : rust.indexOf('"#', literalStart + 3)
  if (fnStart < 0 || literalStart < 0 || literalEnd < 0) {
    throw new Error('origin_rewrite_script format literal not found in rust source')
  }
  const template = rust.slice(literalStart + 3, literalEnd).replace(/\{\{/g, '{').replace(/\}\}/g, '}')
  const json = (value: string): string => JSON.stringify(value)
  return template
    .replace('{carrier}', json(carrierAuthority))
    .replace('{proxy_base}', json(`http://${proxyAuthority}/${secret}`))
    .replace('{proxy_authority_json}', json(proxyAuthority))
    .replace('{secret_json}', json(secret))
}

interface Sandbox {
  fetch: unknown
  WebSocket: unknown
  XMLHttpRequest: { prototype: { open: (...args: unknown[]) => unknown } }
  location: { href: string }
  [key: string]: unknown
}

function install(script: string, pageHref: string): { sandbox: Sandbox; nativeFetchCalls: string[]; nativeWsCalls: string[] } {
  const nativeFetchCalls: string[] = []
  const nativeWsCalls: string[] = []
  const sandbox: Sandbox = {
    fetch: (input: unknown): Promise<unknown> => {
      nativeFetchCalls.push(typeof input === 'string' ? input : String(input))
      return Promise.resolve({ ok: true })
    },
    WebSocket: function NativeWebSocket(url: string): void {
      nativeWsCalls.push(url)
    },
    XMLHttpRequest: { prototype: { open: (...args: unknown[]) => args } },
    location: { href: pageHref },
  }
  new Function('window', 'XMLHttpRequest', 'location', script)(sandbox, sandbox.XMLHttpRequest, sandbox.location)
  return { sandbox, nativeFetchCalls, nativeWsCalls }
}

const CARRIER = '127.0.0.1:43120'
const PROXY = '127.0.0.1:54321'
const SECRET = 's3cret_token_value_with_43_chars_padding_xx'
const PAGE = `http://${PROXY}/${SECRET}/?dsh-desktop-mode=compatibility`

describe('renderer origin rewrite script behavior', () => {
  it('rewrites relative /api fetches onto the secret path (referer branch is not enough for WKWebView)', async () => {
    const { sandbox, nativeFetchCalls } = install(buildScript(CARRIER, PROXY, SECRET), PAGE)
    await (sandbox.fetch as (input: string) => Promise<unknown>)('/api/settings.mutate')
    expect(nativeFetchCalls).toEqual([`http://${PROXY}/${SECRET}/api/settings.mutate`])
  })

  it('rewrites relative WebSocket event paths onto the secret path so the upgrade carries the capability', () => {
    const { sandbox, nativeWsCalls } = install(buildScript(CARRIER, PROXY, SECRET), PAGE)
    const Wrapped = sandbox.WebSocket as new (url: string) => unknown
    new Wrapped('/api/events.mux')
    new Wrapped('/api/events.host')
    expect(nativeWsCalls).toEqual([
      `ws://${PROXY}/${SECRET}/api/events.mux`,
      `ws://${PROXY}/${SECRET}/api/events.host`,
    ])
  })

  it('rewrites the ws: absolute URL objects the kernel client actually constructs (WebKit origin quirk safe)', () => {
    const { sandbox, nativeWsCalls } = install(buildScript(CARRIER, PROXY, SECRET), PAGE)
    const Wrapped = sandbox.WebSocket as new (url: URL) => unknown
    // Exactly the client's shape: URL resolved against the page origin, then
    // protocol flipped to ws: — WebKit computes this origin as `ws://host:port`,
    // so the rewrite must key on the authority instead.
    const url = new URL('/api/events.mux', PAGE)
    url.protocol = 'ws:'
    new Wrapped(url)
    expect(nativeWsCalls).toEqual([`ws://${PROXY}/${SECRET}/api/events.mux`])
  })

  it('rewrites absolute carrier-origin http and ws URLs onto the secret path', async () => {
    const { sandbox, nativeFetchCalls, nativeWsCalls } = install(buildScript(CARRIER, PROXY, SECRET), PAGE)
    await (sandbox.fetch as (input: string) => Promise<unknown>)(`http://${CARRIER}/api/llm.providers`)
    const Wrapped = sandbox.WebSocket as new (url: string) => unknown
    new Wrapped(`ws://${CARRIER}/api/events.mux`)
    expect(nativeFetchCalls).toEqual([`http://${PROXY}/${SECRET}/api/llm.providers`])
    expect(nativeWsCalls).toEqual([`ws://${PROXY}/${SECRET}/api/events.mux`])
  })

  it('leaves already-secreted proxy URLs untouched (no double prefix)', async () => {
    const { sandbox, nativeFetchCalls } = install(buildScript(CARRIER, PROXY, SECRET), PAGE)
    const already = `http://${PROXY}/${SECRET}/plugins/x/client.js`
    await (sandbox.fetch as (input: string) => Promise<unknown>)(already)
    expect(nativeFetchCalls).toEqual([already])
  })

  it('leaves foreign-origin URLs untouched', async () => {
    const { sandbox, nativeFetchCalls } = install(buildScript(CARRIER, PROXY, SECRET), PAGE)
    const external = 'https://example.com/api/settings.mutate'
    await (sandbox.fetch as (input: string) => Promise<unknown>)(external)
    expect(nativeFetchCalls).toEqual([external])
  })
})
