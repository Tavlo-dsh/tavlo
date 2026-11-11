import { describe, expect, it } from 'vitest'
import { decodeMessage, encodeMessage, NATIVE_METHODS, PROTOCOL_VERSION } from '../src/rpc/protocol.ts'

describe('host native RPC protocol', () => {
  it('round-trips a request on one stdout line', () => {
    const encoded = encodeMessage({
      v: PROTOCOL_VERSION,
      type: 'req',
      id: '1',
      method: NATIVE_METHODS.mount,
      params: { generationId: 'g1' },
    })
    expect(encoded.endsWith('\n')).toBe(true)
    expect(encoded.split('\n').filter(Boolean)).toHaveLength(1)
    expect(decodeMessage(encoded)).toEqual({
      v: 1,
      type: 'req',
      id: '1',
      method: 'shell.mount',
      params: { generationId: 'g1' },
    })
  })

  it('rejects a foreign protocol version', () => {
    expect(() => decodeMessage('{"v":2,"type":"req","id":"1","method":"shell.show"}\n'))
      .toThrow('unsupported protocol version')
  })
})
