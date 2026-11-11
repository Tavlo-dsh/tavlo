import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogRecord {
  readonly ts: string
  readonly level: LogLevel
  readonly source: string
  readonly message: string
  readonly data?: unknown
}

export interface LogQuery {
  readonly q?: string
  readonly level?: LogLevel
  readonly limit?: number
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export class LogJournal {
  readonly filePath: string
  private readonly records: LogRecord[] = []

  constructor(
    userDataDir: string,
    private readonly enabled: boolean,
    private readonly maxRecords = 2_000,
  ) {
    this.filePath = join(userDataDir, 'devtools', 'logs.ndjson')
  }

  append(entry: Omit<LogRecord, 'ts'> & { ts?: string }): LogRecord | undefined {
    if (!this.enabled) return undefined
    const record: LogRecord = {
      ts: entry.ts ?? new Date().toISOString(),
      level: entry.level,
      source: entry.source,
      message: entry.message,
      ...(entry.data === undefined ? {} : { data: entry.data }),
    }
    this.records.push(record)
    if (this.records.length > this.maxRecords) this.records.splice(0, this.records.length - this.maxRecords)
    mkdirSync(dirname(this.filePath), { recursive: true })
    appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8')
    return record
  }

  query(query: LogQuery = {}): LogRecord[] {
    const needle = query.q?.trim().toLowerCase()
    const minRank = query.level === undefined ? 0 : LEVEL_RANK[query.level]
    const limit = query.limit ?? 200
    return this.records
      .filter(record => LEVEL_RANK[record.level] >= minRank)
      .filter(record => {
        if (needle === undefined || needle.length === 0) return true
        return `${record.source} ${record.message} ${JSON.stringify(record.data ?? '')}`.toLowerCase().includes(needle)
      })
      .slice(-limit)
      .reverse()
  }

  readFile(): string {
    if (!this.enabled) return ''
    try {
      return readFileSync(this.filePath, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw cause
    }
  }
}
