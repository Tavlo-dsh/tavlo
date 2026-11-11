import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findPackageJSON as nodeFindPackageJSON } from 'node:module'
import { bunHostCompatNeeded, installBunHostCompat, rewriteNodeModuleImports, rewritePackageOverlaySource } from '../src/runtime/bun-host-compat.ts'
import { findPackageJSON, nextResolve, registerHooks } from '../src/runtime/find-package-json.ts'

describe('Bun Host compat', () => {
  it('is not needed under Node', () => {
    expect((process.versions as NodeJS.ProcessVersions & { bun?: string }).bun).toBeUndefined()
    expect(bunHostCompatNeeded()).toBe(false)
  })

  it('does not install a Bun plugin under Node', async () => {
    await expect(installBunHostCompat()).resolves.toBe(false)
  })

  it('rewrites the official package-overlay findPackageJSON import', () => {
    const source = 'import { findPackageJSON } from "node:module";\nexport const n = findPackageJSON;\n'
    const rewritten = rewritePackageOverlaySource(source, 'file:///app/find-package-json.js')
    expect(rewritten).toContain('import { findPackageJSON } from "file:///app/find-package-json.js";')
    expect(rewritten).not.toContain('from "node:module"')
    expect(rewritePackageOverlaySource('export const x = 1\n', 'file:///app/x.js')).toBe('export const x = 1\n')
    const hooks = rewriteNodeModuleImports(
      'import Module, { registerHooks } from "node:module";\n',
      'file:///app/find-package-json.js',
    )
    expect(hooks).toContain('import Module from "node:module";')
    expect(hooks).toContain('import { registerHooks } from "file:///app/find-package-json.js";')
    const pluginLib = join(process.cwd(), '.anywhere-labs-dsh-desktop/dsh-plugin-desktop/lib')
    if (existsSync(pluginLib)) {
      const overlay = readdirSync(pluginLib).find(name => name.startsWith('package-overlay') && name.endsWith('.js'))
      if (overlay !== undefined) {
        const source = readFileSync(join(pluginLib, overlay), 'utf8')
        const rewritten = rewritePackageOverlaySource(source, 'file:///app/find-package-json.js')
        expect(rewritten).toContain('file:///app/find-package-json.js')
        expect(rewritten).not.toContain('from "node:module"')
      }
      const resolution = readFileSync(join(pluginLib, 'module-resolution.js'), 'utf8')
      const rewrittenResolution = rewriteNodeModuleImports(resolution, 'file:///app/find-package-json.js')
      expect(rewrittenResolution).toContain('import Module from "node:module";')
      expect(rewrittenResolution).toContain('registerHooks')
      expect(rewrittenResolution).not.toContain('registerHooks } from "node:module"')
    }
  })

  it('registerHooks stub returns a disposer', () => {
    const hooks = registerHooks({})
    expect(() => hooks.deregister()).not.toThrow()
  })

  it('nextResolve maps missing packages to ERR_MODULE_NOT_FOUND', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-next-resolve-'))
    writeFileSync(join(root, 'package.json'), '{"name":"root"}\n')
    try {
      nextResolve('no-such-dsh-pkg', { parentURL: pathToFileURL(join(root, 'package.json')).href })
      throw new Error('expected throw')
    } catch (cause) {
      expect((cause as NodeJS.ErrnoException).code).toBe('ERR_MODULE_NOT_FOUND')
    }
  })

  it('matches Node findPackageJSON for a resolvable package and missing packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-find-package-json-'))
    mkdirSync(join(root, 'node_modules', 'overlay-pkg'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{"name":"root"}\n')
    writeFileSync(join(root, 'node_modules', 'overlay-pkg', 'package.json'), '{"name":"overlay-pkg","version":"1.0.0"}\n')
    const base = pathToFileURL(join(root, 'package.json')).href
    expect(realpathSync(findPackageJSON('overlay-pkg', base) as string)).toBe(
      realpathSync(nodeFindPackageJSON('overlay-pkg', base) as string),
    )
    try {
      findPackageJSON('no-such-dsh-pkg', base)
      throw new Error('expected throw')
    } catch (cause) {
      expect((cause as NodeJS.ErrnoException).code).toBe('ERR_MODULE_NOT_FOUND')
    }
    expect(() => nodeFindPackageJSON('no-such-dsh-pkg', base)).toThrow()
  })
})
