import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** Extract the exact injected script string from its Rust home (single source of truth). */
function loadScript(): string {
  const rust = readFileSync(join(repoRoot, 'src-tauri/src/settings_conflict_retry.rs'), 'utf8')
  const match = /r#"([\s\S]*?)"#;/.exec(rust)
  if (!match) throw new Error('SETTINGS_CONFLICT_RETRY_SCRIPT raw string not found in rust source')
  return match[1]
}

type RecordedCall = { input: string; init?: RequestInit | undefined }

interface Sandbox {
  fetch: (input: string, init?: RequestInit | undefined) => Promise<Response>
  location: { href: string }
  crypto: { randomUUID: () => string }
  [key: string]: unknown
}

/** Install the script into a sandbox window over the given fetch implementation. */
function install(fetchImpl: (input: string, init?: RequestInit | undefined) => Promise<Response>): {
  sandbox: Sandbox
  calls: RecordedCall[]
} {
  const calls: RecordedCall[] = []
  const tracked = (input: string, init?: RequestInit | undefined): Promise<Response> => {
    calls.push({ input, init })
    return fetchImpl(input, init)
  }
  const sandbox: Sandbox = {
    fetch: tracked,
    location: { href: 'http://127.0.0.1:43120/' },
    crypto: globalThis.crypto,
  }
  new Function('window', loadScript())(sandbox)
  return { sandbox, calls }
}

function jsonResponse(rpcId: string, result: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({ type: 'server-response', rpcId, result }),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

function mutateBody(rpcId: string, expectedRevision: number | undefined, method = 'settings.mutate'): string {
  const payload: Record<string, unknown> = {
    ns: 'llm-pi-ai',
    ops: [{ op: 'set', path: ['providers', 'p1'], value: { api: 'anthropic-messages' } }],
  }
  if (expectedRevision !== undefined) payload.expectedRevision = expectedRevision
  return JSON.stringify({ type: 'client-request', rpcId, method, payload })
}

function conflictResult(expected: number, actual: number): unknown {
  return {
    ok: false,
    error: {
      code: 'settings-conflict',
      message: `settings namespace "llm-pi-ai" changed since it was read (expected revision ${expected}, now ${actual})`,
      details: { ns: 'llm-pi-ai', expected, actual },
    },
  }
}

const OK_RESULT = { ok: true, value: { ns: 'llm-pi-ai', revision: 2 } }

function okOnce(rpcId: string): () => Promise<Response> {
  let n = 0
  return () => {
    n += 1
    if (n === 1) return Promise.resolve(jsonResponse(rpcId, conflictResult(0, 1)))
    return Promise.resolve(jsonResponse(rpcId, OK_RESULT))
  }
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>
}

describe('settings-conflict retry injection', () => {
  it('retries a conflicted settings.mutate once with details.actual and surfaces the retry success', async () => {
    const { sandbox, calls } = install(okOnce('rpc-1'))
    const response = await sandbox.fetch('http://127.0.0.1:43120/api/settings.mutate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: mutateBody('rpc-1', 0),
    })
    expect(calls).toHaveLength(2)
    const retry = JSON.parse(String(calls[1]?.init?.body)) as {
      rpcId: string
      method: string
      type: string
      payload: { expectedRevision: number }
    }
    expect(retry.rpcId).toBe('rpc-1')
    expect(retry.type).toBe('client-request')
    expect(retry.method).toBe('settings.mutate')
    expect(retry.payload.expectedRevision).toBe(1)
    expect(await bodyOf(response)).toEqual(JSON.parse(JSON.stringify({ type: 'server-response', rpcId: 'rpc-1', result: OK_RESULT })))
  })

  it('surfaces a second conflict without a third call', async () => {
    const { sandbox, calls } = install(() => Promise.resolve(jsonResponse('rpc-1', conflictResult(0, 1))))
    const response = await sandbox.fetch('http://127.0.0.1:43120/api/settings.mutate', {
      method: 'POST',
      body: mutateBody('rpc-1', 0),
    })
    expect(calls).toHaveLength(2)
    const body = (await bodyOf(response)) as { result: { error: { details: { actual: number } } } }
    expect(body.result.error.details.actual).toBe(1)
  })

  it('does not retry settings.replace even on conflict (wholesale rebuild may clobber a concurrent writer)', async () => {
    const { sandbox, calls } = install(okOnce('rpc-1'))
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-1',
      method: 'settings.replace',
      payload: { ns: 'llm-pi-ai', section: {}, expectedRevision: 0 },
    })
    const response = await sandbox.fetch('http://127.0.0.1:43120/api/settings.replace', { method: 'POST', body })
    expect(calls).toHaveLength(1)
    const parsed = (await bodyOf(response)) as { result: { ok: boolean; error: { code: string } } }
    expect(parsed.result.ok).toBe(false)
    expect(parsed.result.error.code).toBe('settings-conflict')
  })

  it('does not retry when the request carried no expectedRevision', async () => {
    const { sandbox, calls } = install(okOnce('rpc-1'))
    await sandbox.fetch('http://127.0.0.1:43120/api/settings.mutate', {
      method: 'POST',
      body: mutateBody('rpc-1', undefined),
    })
    expect(calls).toHaveLength(1)
  })

  it('passes success, non-conflict errors, other methods, and GET streams through untouched', async () => {
    // Success envelope: single call.
    const successFetch = (): Promise<Response> => Promise.resolve(jsonResponse('rpc-1', OK_RESULT))
    const success = install(successFetch)
    const okResponse = await success.sandbox.fetch('http://127.0.0.1:43120/api/settings.mutate', {
      method: 'POST',
      body: mutateBody('rpc-1', 0),
    })
    expect(success.calls).toHaveLength(1)
    expect((await bodyOf(okResponse)).result).toEqual(OK_RESULT)

    // settings-rejected: not a conflict, single call.
    const rejected = install(
      () => Promise.resolve(jsonResponse('rpc-1', { ok: false, error: { code: 'settings-rejected', message: 'nope', details: { ns: 'llm-pi-ai' } } })),
    )
    const rejectedResponse = await rejected.sandbox.fetch('http://127.0.0.1:43120/api/settings.mutate', {
      method: 'POST',
      body: mutateBody('rpc-1', 0),
    })
    expect(rejected.calls).toHaveLength(1)
    expect((await bodyOf(rejectedResponse)).result).toMatchObject({ ok: false })

    // llm.discoverModels conflict-shaped error: outside the retryable set.
    const discover = install(
      () => Promise.resolve(jsonResponse('rpc-2', { ok: false, error: { code: 'settings-conflict', message: 'x', details: { ns: 'llm-pi-ai', expected: 0, actual: 1 } } })),
    )
    const discoverResponse = await discover.sandbox.fetch('http://127.0.0.1:43120/api/llm.discoverModels', {
      method: 'POST',
      body: mutateBody('rpc-2', 0, 'llm.discoverModels'),
    })
    expect(discover.calls).toHaveLength(1)
    expect(discoverResponse.status).toBe(200)

    // SSE GET: never intercepted.
    const stream = install(() => Promise.resolve(new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } })))
    const streamResponse = await stream.sandbox.fetch('http://127.0.0.1:43120/api/events.mux', { method: 'GET' })
    expect(stream.calls).toHaveLength(1)
    expect(await streamResponse.text()).toBe('data: {}\n\n')
  })

  it('returns the original conflict response when the retry transport itself fails', async () => {
    let n = 0
    const { sandbox, calls } = install(() => {
      n += 1
      if (n === 1) return Promise.resolve(jsonResponse('rpc-1', conflictResult(0, 1)))
      return Promise.reject(new Error('abort'))
    })
    void calls
    const response = await sandbox.fetch('http://127.0.0.1:43120/api/settings.mutate', {
      method: 'POST',
      body: mutateBody('rpc-1', 0),
    })
    expect(calls).toHaveLength(2)
    const parsed = (await bodyOf(response)) as { result: { error: { code: string } } }
    expect(parsed.result.error.code).toBe('settings-conflict')
  })

  it('passes a non-JSON response through to the caller untouched', async () => {
    const { sandbox, calls } = install(() => Promise.resolve(new Response('gateway garbage', { status: 502 })))
    const response = await sandbox.fetch('http://127.0.0.1:43120/api/settings.mutate', {
      method: 'POST',
      body: mutateBody('rpc-1', 0),
    })
    expect(calls).toHaveLength(1)
    expect(response.status).toBe(502)
    expect(await response.text()).toBe('gateway garbage')
  })

  it('installs at most once per window', () => {
    const { sandbox } = install(() => Promise.resolve(jsonResponse('rpc-1', OK_RESULT)))
    const wrapped = sandbox.fetch
    new Function('window', loadScript())(sandbox)
    expect(sandbox.fetch).toBe(wrapped)
    expect(sandbox.__DSH_SETTINGS_CONFLICT_RETRY__).toBe(true)
  })
})
