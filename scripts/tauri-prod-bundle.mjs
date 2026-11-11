import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.DSH_DEV_TOOLS = '0'
process.env.DSH_PROFILE = 'production'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const localTauri = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri')
const command = existsSync(localTauri) ? localTauri : 'npx'
const args = existsSync(localTauri) ? ['build', ...process.argv.slice(2)] : ['tauri', 'build', ...process.argv.slice(2)]

const child = spawn(command, args, {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
})
child.on('exit', code => {
  process.exit(code ?? 1)
})
