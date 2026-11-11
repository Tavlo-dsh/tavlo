import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

function toFilePath(value: string | URL | undefined): string {
  if (value === undefined) return process.cwd()
  if (typeof value !== 'string') return fileURLToPath(value)
  if (value.startsWith('file:')) return fileURLToPath(value)
  return value
}

function nearestPackageJSON(start: string): string | undefined {
  let dir = start.endsWith('package.json') ? dirname(start) : start
  for (;;) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function isPathLike(spec: string): boolean {
  return spec.startsWith('file:') || spec.startsWith('.') || isAbsolute(spec)
}

function moduleNotFound(cause: unknown, packageName: string, from: string): NodeJS.ErrnoException {
  const message = cause instanceof Error ? cause.message : `Cannot find package '${packageName}' imported from ${from}`
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = 'ERR_MODULE_NOT_FOUND'
  return error
}

/** Node `module.findPackageJSON` stand-in for Bun, which does not export it. */
export function findPackageJSON(
  specifier: string | URL,
  base?: string | URL,
): string | undefined {
  const spec = typeof specifier === 'string' ? specifier : fileURLToPath(specifier)
  const baseFile = toFilePath(base)
  if (isPathLike(spec)) {
    const start = spec.startsWith('file:')
      ? fileURLToPath(spec)
      : isAbsolute(spec)
        ? spec
        : join(dirname(baseFile), spec)
    return nearestPackageJSON(start)
  }
  const require = createRequire(baseFile)
  try {
    try {
      return require.resolve(`${spec}/package.json`)
    } catch {
      return nearestPackageJSON(require.resolve(spec))
    }
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      throw moduleNotFound(cause, spec, baseFile)
    }
    throw cause
  }
}

type ResolveContext = { parentURL?: string }
type ResolveResult = { url: string }
type NextResolve = (specifier: string, context: ResolveContext) => ResolveResult
type ResolveHook = (specifier: string, context: ResolveContext, nextResolve: NextResolve) => ResolveResult

type BunPluginApi = {
  plugin: (options: {
    name: string
    setup: (build: {
      onResolve: (
        options: { filter: RegExp },
        callback: (args: { path: string, importer: string }) => { path: string } | undefined,
      ) => void
    }) => void
  }) => void
}

let activeResolve: ResolveHook | undefined
let bunResolvePluginInstalled = false
let resolving = false

function bunApi(): BunPluginApi | undefined {
  const value = (globalThis as { Bun?: BunPluginApi }).Bun
  return value?.plugin === undefined ? undefined : value
}

function toParentFile(parentURL: string | undefined): string {
  if (parentURL === undefined || parentURL.length === 0) return join(process.cwd(), 'package.json')
  return parentURL.startsWith('file:') ? fileURLToPath(parentURL) : parentURL
}

export function nextResolve(specifier: string, context: ResolveContext): ResolveResult {
  const require = createRequire(toParentFile(context.parentURL))
  try {
    return { url: pathToFileURL(require.resolve(specifier)).href }
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException | undefined)?.code
    const error = new Error(cause instanceof Error ? cause.message : String(cause)) as NodeJS.ErrnoException
    error.code = code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND' ? 'ERR_MODULE_NOT_FOUND' : code
    throw error
  }
}

function installBunResolvePlugin(): void {
  if (bunResolvePluginInstalled) return
  const bun = bunApi()
  if (bun === undefined) return
  bunResolvePluginInstalled = true
  bun.plugin({
    name: 'dsh-register-hooks',
    setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (resolving || activeResolve === undefined) return undefined
        if (args.path.startsWith('node:') || args.path.startsWith('bun:')) return undefined
        const parentURL = args.importer.length === 0
          ? undefined
          : args.importer.startsWith('file:')
            ? args.importer
            : pathToFileURL(args.importer).href
        resolving = true
        try {
          const context: ResolveContext = parentURL === undefined ? {} : { parentURL }
          const result = activeResolve(args.path, context, nextResolve)
          if (result.url.startsWith('file:')) return { path: fileURLToPath(result.url) }
          return { path: result.url }
        } catch {
          return undefined
        } finally {
          resolving = false
        }
      })
    },
  })
}

/** Node `registerHooks` stand-in: Bun has no ESM customization hooks, so this drives `Bun.plugin`. */
export function registerHooks(hooks?: {
  readonly resolve?: ResolveHook
  readonly load?: unknown
}): { deregister(): void } {
  const resolve = hooks?.resolve
  activeResolve = resolve
  if (resolve !== undefined) installBunResolvePlugin()
  return {
    deregister() {
      if (activeResolve === resolve) activeResolve = undefined
    },
  }
}
