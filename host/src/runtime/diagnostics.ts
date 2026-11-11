import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildZipStore } from './zip-store.ts'

export function exportDiagnosticsArchive(userDataDir: string, appVersion: string): string {
  const files: { name: string, data: Buffer }[] = [{
    name: 'system-info.txt',
    data: Buffer.from(`product: DSH Desktop\nversion: ${appVersion}\nplatform: ${process.platform}\n`, 'utf8'),
  }]
  try {
    for (const entry of readdirSync(join(userDataDir, 'logs'))) {
      if (!entry.endsWith('.log')) continue
      files.push({
        name: `logs/${entry}`,
        data: readFileSync(join(userDataDir, 'logs', entry)),
      })
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  try {
    files.push({
      name: 'crash-evidence/active-run.json',
      data: readFileSync(join(userDataDir, 'crash-evidence', 'active-run.json')),
    })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  const dir = join(userDataDir, 'diagnostics')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `dsh-diagnostics-${String(Date.now())}.zip`)
  writeFileSync(path, buildZipStore(files))
  return path
}
