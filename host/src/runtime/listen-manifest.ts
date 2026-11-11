import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface DevtoolsListenManifest {
  readonly version: 1
  readonly enabled: boolean
  readonly logsPath: string
  readonly networkPath: string
  readonly http: {
    readonly origin: string
    readonly logs: string
    readonly network: string
    readonly ui: string
    readonly meta: string
  } | null
}

export function writeListenManifest(userDataDir: string, manifest: DevtoolsListenManifest): string {
  const dir = join(userDataDir, 'devtools')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'listen.json')
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
  return path
}

export function listenManifestPath(userDataDir: string): string {
  return join(userDataDir, 'devtools', 'listen.json')
}
