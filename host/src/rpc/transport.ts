import {
  decodeMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type RpcEvent,
  type RpcMessage,
  type RpcRequest,
} from './protocol.ts'

export interface RpcTransport {
  request<T>(method: string, params?: unknown): Promise<T>
  notify(method: string, params?: unknown): void
  on(method: string, handler: (params: unknown) => void): () => void
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/** In-memory bus used by tests and to connect sidecar logic to a native dispatcher. */
export class LoopbackRpcTransport implements RpcTransport {
  private readonly pending = new Map<string, Pending>()
  private readonly listeners = new Map<string, Set<(params: unknown) => void>>()
  private nextId = 1

  constructor(
    private readonly dispatch: (method: string, params: unknown) => unknown | Promise<unknown>,
  ) {}

  async request<T>(method: string, params?: unknown): Promise<T> {
    const id = String(this.nextId)
    this.nextId += 1
    try {
      const result = await this.dispatch(method, params)
      return result as T
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new Error(message)
    } finally {
      this.pending.delete(id)
    }
  }

  notify(method: string, params?: unknown): void {
    void this.dispatch(method, params)
  }

  emit(method: string, params?: unknown): void {
    const handlers = this.listeners.get(method)
    if (handlers === undefined) return
    for (const handler of handlers) handler(params)
  }

  on(method: string, handler: (params: unknown) => void): () => void {
    const existing = this.listeners.get(method) ?? new Set()
    existing.add(handler)
    this.listeners.set(method, existing)
    return () => {
      existing.delete(handler)
    }
  }
}

export function parseRpcLine(line: string): RpcMessage {
  return decodeMessage(line)
}

export function requestMessage(id: string, method: string, params?: unknown): RpcRequest {
  return {
    v: PROTOCOL_VERSION,
    type: 'req',
    id,
    method,
    ...(params === undefined ? {} : { params }),
  }
}

export function eventMessage(method: string, params?: unknown): RpcEvent {
  return {
    v: PROTOCOL_VERSION,
    type: 'evt',
    method,
    ...(params === undefined ? {} : { params }),
  }
}

export function writeRpc(message: RpcMessage): string {
  return encodeMessage(message)
}
