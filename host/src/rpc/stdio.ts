import { decodeMessage, encodeMessage, PROTOCOL_VERSION, type RpcMessage } from './protocol.ts'
import type { RpcTransport } from './transport.ts'

export function createStdioTransport(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): RpcTransport {
  const pending = new Map<string, { resolve: (value: unknown) => void, reject: (reason: unknown) => void }>()
  const listeners = new Map<string, Set<(params: unknown) => void>>()
  let nextId = 1
  let buffer = ''

  const write = (message: RpcMessage): void => {
    output.write(encodeMessage(message))
  }

  input.setEncoding?.('utf8')
  input.on('data', (chunk: string | Buffer) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      try {
        const message = decodeMessage(line)
        if (message.type === 'res') {
          pending.get(message.id)?.resolve(message.result)
          pending.delete(message.id)
        } else if (message.type === 'err') {
          pending.get(message.id)?.reject(new Error(message.error.message))
          pending.delete(message.id)
        } else if (message.type === 'evt') {
          const handlers = listeners.get(message.method)
          if (handlers !== undefined) {
            for (const handler of handlers) handler(message.params)
          }
        }
      } catch (cause) {
        process.stderr.write(`dsh-desktop: rpc decode failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      }
      newline = buffer.indexOf('\n')
    }
  })

  return {
    request<T>(method: string, params?: unknown): Promise<T> {
      const id = String(nextId)
      nextId += 1
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          resolve: value => { resolve(value as T) },
          reject,
        })
        write({
          v: PROTOCOL_VERSION,
          type: 'req',
          id,
          method,
          ...(params === undefined ? {} : { params }),
        })
      })
    },
    notify(method: string, params?: unknown): void {
      write({
        v: PROTOCOL_VERSION,
        type: 'evt',
        method,
        ...(params === undefined ? {} : { params }),
      })
    },
    on(method: string, handler: (params: unknown) => void): () => void {
      const existing = listeners.get(method) ?? new Set()
      existing.add(handler)
      listeners.set(method, existing)
      return () => { existing.delete(handler) }
    },
  }
}
