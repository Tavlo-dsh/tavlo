import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface NetworkRecord {
  readonly id: string
  readonly ts: string
  readonly method: string
  readonly url: string
  readonly status?: number
  readonly durationMs?: number
  readonly requestBytes?: number
  readonly responseBytes?: number
  readonly error?: string
}

export interface NetworkQuery {
  readonly q?: string
  readonly method?: string
  readonly limit?: number
}

export class NetworkJournal {
  readonly filePath: string
  private readonly records: NetworkRecord[] = []

  constructor(
    userDataDir: string,
    private readonly enabled: boolean,
    private readonly maxRecords = 2_000,
  ) {
    this.filePath = join(userDataDir, 'devtools', 'network.ndjson')
  }

  append(entry: Omit<NetworkRecord, 'id' | 'ts'> & { id?: string, ts?: string }): NetworkRecord | undefined {
    if (!this.enabled) return undefined
    const record: NetworkRecord = {
      id: entry.id ?? randomUUID(),
      ts: entry.ts ?? new Date().toISOString(),
      method: entry.method.toUpperCase(),
      url: entry.url,
      ...(entry.status === undefined ? {} : { status: entry.status }),
      ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
      ...(entry.requestBytes === undefined ? {} : { requestBytes: entry.requestBytes }),
      ...(entry.responseBytes === undefined ? {} : { responseBytes: entry.responseBytes }),
      ...(entry.error === undefined ? {} : { error: entry.error }),
    }
    this.records.push(record)
    if (this.records.length > this.maxRecords) this.records.splice(0, this.records.length - this.maxRecords)
    mkdirSync(dirname(this.filePath), { recursive: true })
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    return record
  }

  query(query: NetworkQuery = {}): NetworkRecord[] {
    const needle = query.q?.trim().toLowerCase()
    const method = query.method?.trim().toUpperCase()
    const limit = query.limit ?? 200
    return this.records
      .filter(record => method === undefined || method.length === 0 || record.method === method)
      .filter(record => {
        if (needle === undefined || needle.length === 0) return true
        return `${record.method} ${record.url} ${String(record.status ?? '')} ${record.error ?? ''}`.toLowerCase().includes(needle)
      })
      .slice(-limit)
      .reverse()
  }

  wrapFetch(fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
    const journal = this
    return (async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : 'GET') ?? 'GET').toUpperCase()
      const started = Date.now()
      try {
        const response = await fetchImpl(input, init)
        const size = Number(response.headers.get('content-length') ?? 0)
        journal.append({
          method,
          url,
          status: response.status,
          durationMs: Date.now() - started,
          ...(size > 0 ? { responseBytes: size } : {}),
        })
        return response
      } catch (cause) {
        journal.append({
          method,
          url,
          durationMs: Date.now() - started,
          error: cause instanceof Error ? cause.message : String(cause),
        })
        throw cause
      }
    }) as typeof fetch
  }
}
