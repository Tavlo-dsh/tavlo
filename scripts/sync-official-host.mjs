import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'host/upstream/tauri-host.ts')
const plugin = [
  join(root, '.anywhere-labs-dsh-desktop/dsh-plugin-desktop'),
  join(root, 'anywhere-labs-dsh-desktop/dsh-plugin-desktop'),
].find(candidate => existsSync(candidate)) ?? join(root, '.anywhere-labs-dsh-desktop/dsh-plugin-desktop')
const dest = join(plugin, 'src/tauri-host.ts')
const compiled = join(plugin, 'lib/tauri-host.js')
const workspaceRoot = dirname(plugin)

if (!existsSync(source)) {
  process.stderr.write('dsh-desktop: host/upstream/tauri-host.ts is missing\n')
  process.exit(1)
}
if (!existsSync(plugin)) {
  process.stderr.write('dsh-desktop: official dsh-plugin-desktop checkout is not present; Host will use the loopback placeholder\n')
  process.exit(0)
}
mkdirSync(dirname(dest), { recursive: true })
copyFileSync(source, dest)
if (!existsSync(compiled) || process.env.DSH_REBUILD_OFFICIAL_HOST === '1') {
  const result = spawnSync('yarn', ['workspace', 'dsh-plugin-desktop', 'exec', 'tsdown'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
process.stderr.write(`dsh-desktop: official Host launcher synced to ${dest}\n`)
