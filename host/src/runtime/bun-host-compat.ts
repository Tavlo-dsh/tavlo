import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as nodeModule from 'node:module'

const NODE_MODULE_IMPORT = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\{([^}]+)\}\s*from\s*['"]node:module['"]\s*;?/g
const BUN_MISSING_NODE_MODULE_EXPORTS = ['findPackageJSON', 'registerHooks'] as const
const HOST_FILES_NEEDING_SHIM = /(?:package-overlay|module-resolution)[^/]*\.(?:js|ts)$/

type BunFileApi = {
  plugin: (options: {
    name: string
    setup: (build: {
      onLoad: (
        options: { filter: RegExp },
        callback: (args: { path: string }) => Promise<{ contents: string, loader: 'js' }>,
      ) => void
    }) => void
  }) => void
  file: (path: string) => { text: () => Promise<string> }
}

function bunVersion(): string | undefined {
  return (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun
}

function nativeExportAvailable(name: string): boolean {
  return typeof (nodeModule as unknown as Record<string, unknown>)[name] === 'function'
}

async function loadBunApi(): Promise<BunFileApi | undefined> {
  try {
    return await (new Function('return import("bun")')() as Promise<BunFileApi>)
  } catch {
    return undefined
  }
}

export function rewriteNodeModuleImports(
  source: string,
  polyfillSpecifier: string,
  missingNames: readonly string[] = BUN_MISSING_NODE_MODULE_EXPORTS,
): string {
  const missing = new Set(missingNames)
  return source.replace(NODE_MODULE_IMPORT, (full, defaultBinding: string | undefined, specifiers: string) => {
    const parts = specifiers.split(',').map(part => part.trim()).filter(part => part.length > 0)
    const keep: string[] = []
    const polyfill: string[] = []
    for (const part of parts) {
      const imported = part.split(/\s+as\s+/)[0]?.trim() ?? ''
      if (missing.has(imported)) polyfill.push(part)
      else keep.push(part)
    }
    if (polyfill.length === 0) return full
    const lines: string[] = []
    if (defaultBinding !== undefined && defaultBinding.length > 0 && keep.length > 0) {
      lines.push(`import ${defaultBinding}, { ${keep.join(', ')} } from "node:module";`)
    } else if (defaultBinding !== undefined && defaultBinding.length > 0) {
      lines.push(`import ${defaultBinding} from "node:module";`)
    } else if (keep.length > 0) {
      lines.push(`import { ${keep.join(', ')} } from "node:module";`)
    }
    lines.push(`import { ${polyfill.join(', ')} } from ${JSON.stringify(polyfillSpecifier)};`)
    return lines.join('\n')
  })
}

export function rewritePackageOverlaySource(source: string, polyfillSpecifier: string): string {
  return rewriteNodeModuleImports(source, polyfillSpecifier)
}

export function bunHostCompatNeeded(): boolean {
  return bunVersion() !== undefined && BUN_MISSING_NODE_MODULE_EXPORTS.some(name => !nativeExportAvailable(name))
}

export function polyfillModuleHref(): string {
  const js = new URL('./find-package-json.js', import.meta.url)
  if (existsSync(fileURLToPath(js))) return js.href
  return new URL('./find-package-json.ts', import.meta.url).href
}

/** Rewrite official Host files so Bun can link missing `node:module` exports. No-op on Node. */
export async function installBunHostCompat(): Promise<boolean> {
  if (!bunHostCompatNeeded()) return false
  const bun = await loadBunApi()
  if (bun === undefined) return false
  const polyfillHref = polyfillModuleHref()
  bun.plugin({
    name: 'dsh-find-package-json',
    setup(build) {
      build.onLoad({ filter: HOST_FILES_NEEDING_SHIM }, async args => {
        const source = await bun.file(args.path).text()
        return { contents: rewriteNodeModuleImports(source, polyfillHref), loader: 'js' }
      })
    },
  })
  return true
}
