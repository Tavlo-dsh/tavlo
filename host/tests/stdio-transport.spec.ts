import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { encodeMessage, PROTOCOL_VERSION } from '../src/rpc/protocol.ts'
import { createStdioTransport } from '../src/rpc/stdio.ts'

describe('stdio RPC transport', () => {
  it('resolves a response written back on stdin', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const chunks: string[] = []
    output.on('data', chunk => { chunks.push(String(chunk)) })
    const transport = createStdioTransport(input, output)
    const pending = transport.request<{ ok: boolean }>('shell.show')
    await new Promise(resolve => setImmediate(resolve))
    expect(chunks.join('')).toContain('"method":"shell.show"')
    input.write(encodeMessage({
      v: PROTOCOL_VERSION,
      type: 'res',
      id: '1',
      result: { ok: true },
    }))
    await expect(pending).resolves.toEqual({ ok: true })
  })

  it('delivers native events to listeners', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createStdioTransport(input, output)
    const seen: unknown[] = []
    transport.on('event.trayInvoke', params => { seen.push(params) })
    input.write(encodeMessage({
      v: PROTOCOL_VERSION,
      type: 'evt',
      method: 'event.trayInvoke',
      params: { id: 'tray-1' },
    }))
    await new Promise(resolve => setImmediate(resolve))
    expect(seen).toEqual([{ id: 'tray-1' }])
  })
})
