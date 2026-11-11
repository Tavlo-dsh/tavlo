import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { officialHostDisabled, officialHostEntry } from '../src/runtime/official-host.ts'
import { dshPluginDesktopRoot } from '../src/runtime/paths.ts'

const root = dshPluginDesktopRoot()
const entry = join(root, 'lib/tauri-host.js')
// The upstream checkout is gitignored and optional; CI runs without it.
const hasCompiledLauncher = existsSync(entry)
const bunCompat = join(dirname(fileURLToPath(import.meta.url)), '../dist/runtime/bun-host-compat.js')

function bunExecutable(): string | undefined {
  const home = process.env.HOME
  const candidates = [
    home === undefined ? undefined : join(home, '.bun/bin/bun'),
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
  ]
  return candidates.find(candidate => candidate !== undefined && existsSync(candidate))
}

describe('official dsh-plugin-desktop Host', () => {
  it('selects the compiled launcher unless DSH_OFFICIAL_HOST is off', () => {
    expect(officialHostDisabled({ DSH_OFFICIAL_HOST: '0' })).toBe(true)
    expect(officialHostEntry(root, { DSH_OFFICIAL_HOST: '0' })).toBeUndefined()
    expect(officialHostEntry(root, {})).toBe(hasCompiledLauncher ? entry : undefined)
  })

  it.skipIf(!hasCompiledLauncher)('exposes startTauriHost from the compiled upstream launcher', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { pathToFileURL } from 'node:url'
      const loaded = await import(pathToFileURL(${JSON.stringify(entry)}).href)
      if (typeof loaded.startTauriHost !== 'function') process.exit(2)
    `], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
  })

  const bun = bunExecutable()
  it.skipIf(!hasCompiledLauncher || bun === undefined || !existsSync(bunCompat))(
    'imports startTauriHost under bun after Host compat',
    () => {
      const result = spawnSync(bun as string, [
        '--bun',
        '--no-env-file',
        '--no-install',
        '-e',
        `
          import { installBunHostCompat } from ${JSON.stringify(pathToFileURL(bunCompat).href)}
          import { pathToFileURL } from 'node:url'
          await installBunHostCompat()
          const loaded = await import(pathToFileURL(${JSON.stringify(entry)}).href)
          if (typeof loaded.startTauriHost !== 'function') process.exit(2)
        `,
      ], { encoding: 'utf8' })
      expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0)
    },
  )
})
