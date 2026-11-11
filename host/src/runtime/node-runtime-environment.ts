import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PATH = 'PATH'
const DIRECTORY_MODE = 0o700
const EXECUTABLE_FILE_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
/** Same process-local pnpm policy as upstream `PNPM_IGNORE_MINIMUM_RELEASE_AGE`. */
export const PNPM_IGNORE_MINIMUM_RELEASE_AGE = '--config.minimumReleaseAge=0'

export interface DesktopNodeRuntimeOptions {
  readonly platform: NodeJS.Platform
  readonly nodeExecutable: string
  readonly pnpmBinPath: string
  readonly nodeVersion: string
  readonly stateDir: string
  readonly environment?: NodeJS.ProcessEnv
}

export interface DesktopNodeRuntimeInstallation {
  readonly pathDir: string
  readonly pnpmShimPath: string
  readonly nodeBinDir: string
  readonly nodeShimPath: string
  readonly clearEnvironmentPath: string
  dispose(): void
}

function assertScriptValue(label: string, value: string): void {
  if (value.length === 0) {
    throw new Error(`dsh-desktop: command runtime ${label} must not be empty`)
  }
  if (/[\0\r\n]/u.test(value)) {
    throw new Error(`dsh-desktop: command runtime ${label} must not contain NUL or newlines`)
  }
}

function quoteSh(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function quoteBatchWord(value: string): string {
  if (/["\r\n]/u.test(value)) {
    throw new Error('dsh-desktop: pnpm runtime Windows arguments must not contain quotes or newlines')
  }
  return `"${value.replaceAll('%', '%%')}"`
}

function escapeBatchSetValue(value: string): string {
  if (/["\r\n]/u.test(value)) {
    throw new Error('dsh-desktop: pnpm runtime Windows environment values must not contain quotes or newlines')
  }
  return value.replaceAll('%', '%%')
}

export function posixNodeShim(nodeExecutable: string): string {
  return ['#!/bin/sh', `exec ${quoteSh(nodeExecutable)} "$@"`, ''].join('\n')
}

export function posixPnpmShim(options: Pick<DesktopNodeRuntimeOptions, 'nodeExecutable' | 'pnpmBinPath' | 'nodeVersion'>, nodeBinDir: string, nodeShimPath: string): string {
  return [
    '#!/bin/sh',
    [
      `PATH=${quoteSh(nodeBinDir)}:"\${PATH:-}"`,
      `NODE=${quoteSh(nodeShimPath)}`,
      'npm_config_runtime=node',
      `npm_config_target=${quoteSh(options.nodeVersion)}`,
      `exec ${quoteSh(options.nodeExecutable)} ${quoteSh(options.pnpmBinPath)} ${PNPM_IGNORE_MINIMUM_RELEASE_AGE} "$@"`,
    ].join(' '),
    '',
  ].join('\n')
}

export function windowsNodeShim(nodeExecutable: string): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `${quoteBatchWord(nodeExecutable)} %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

export function windowsPnpmShim(
  options: Pick<DesktopNodeRuntimeOptions, 'nodeExecutable' | 'pnpmBinPath' | 'nodeVersion'>,
  nodeBinDir: string,
  nodeShimPath: string,
): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `set "PATH=${escapeBatchSetValue(nodeBinDir)};%PATH%"`,
    `set "NODE=${escapeBatchSetValue(nodeShimPath)}"`,
    'set "npm_config_runtime=node"',
    `set "npm_config_target=${escapeBatchSetValue(options.nodeVersion)}"`,
    `${quoteBatchWord(options.nodeExecutable)} ${quoteBatchWord(options.pnpmBinPath)} ${PNPM_IGNORE_MINIMUM_RELEASE_AGE} %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

function pathEntries(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): { key: string, value: string | undefined }[] {
  return Object.entries(environment)
    .filter(([key]) => platform === 'win32' ? key.toUpperCase() === PATH : key === PATH)
    .map(([key, value]) => ({ key, value }))
}

function normalizedPathComponent(component: string, platform: NodeJS.Platform): string {
  const unquoted = platform === 'win32' && component.startsWith('"') && component.endsWith('"')
    ? component.slice(1, -1)
    : component
  return platform === 'win32' ? unquoted.toLowerCase() : unquoted
}

function withoutPathDirectory(value: string, directory: string, platform: NodeJS.Platform): string {
  const delimiter = platform === 'win32' ? ';' : ':'
  const target = normalizedPathComponent(directory, platform)
  return value
    .split(delimiter)
    .filter(component => normalizedPathComponent(component, platform) !== target)
    .join(delimiter)
}

function installPathDirectory(
  environment: NodeJS.ProcessEnv,
  directory: string,
  platform: NodeJS.Platform,
): () => void {
  const original = pathEntries(environment, platform)
  const current = original.find(entry => entry.value !== undefined)
  const currentValue = current?.value ?? ''
  if (withoutPathDirectory(currentValue, directory, platform) !== currentValue) return () => {}

  const key = current?.key ?? PATH
  const delimiter = platform === 'win32' ? ';' : ':'
  const installedValue = currentValue.length === 0 ? directory : `${directory}${delimiter}${currentValue}`
  for (const entry of original) delete environment[entry.key]
  environment[key] = installedValue

  let active = true
  return () => {
    if (!active) return
    active = false
    const latest = pathEntries(environment, platform)
    if (latest.length === 1 && latest[0]?.key === key && latest[0].value === installedValue) {
      delete environment[key]
      for (const entry of original) environment[entry.key] = entry.value
      return
    }
    for (const entry of latest) {
      if (entry.value === undefined) continue
      environment[entry.key] = withoutPathDirectory(entry.value, directory, platform)
    }
  }
}

export function assertShimUsesRealNode(source: string): void {
  if (source.includes('ELECTRON_RUN_AS_NODE')) {
    throw new Error('dsh-desktop: shim must not set ELECTRON_RUN_AS_NODE')
  }
  if (source.includes('npm_config_runtime=electron') || source.includes('npm_config_runtime=electron')) {
    throw new Error('dsh-desktop: shim must not target the Electron ABI')
  }
  if (source.includes('electronjs.org/headers')) {
    throw new Error('dsh-desktop: shim must not download Electron headers')
  }
}

export function installDesktopNodeRuntime(options: DesktopNodeRuntimeOptions): DesktopNodeRuntimeInstallation {
  for (const [label, value] of [
    ['node executable', options.nodeExecutable],
    ['pnpm entry', options.pnpmBinPath],
    ['node version', options.nodeVersion],
    ['state directory', options.stateDir],
  ] as const) assertScriptValue(label, value)

  const pathDir = join(options.stateDir, 'bin')
  const nodeBinDir = join(options.stateDir, 'node-bin')
  mkdirSync(options.stateDir, { recursive: true, mode: DIRECTORY_MODE })
  mkdirSync(pathDir, { recursive: true, mode: DIRECTORY_MODE })
  mkdirSync(nodeBinDir, { recursive: true, mode: DIRECTORY_MODE })

  const windows = options.platform === 'win32'
  const nodeShimPath = join(nodeBinDir, windows ? 'node.cmd' : 'node')
  const pnpmShimPath = join(pathDir, windows ? 'pnpm.cmd' : 'pnpm')
  const nodeShim = windows ? windowsNodeShim(options.nodeExecutable) : posixNodeShim(options.nodeExecutable)
  const pnpmShim = windows
    ? windowsPnpmShim(options, nodeBinDir, nodeShimPath)
    : posixPnpmShim(options, nodeBinDir, nodeShimPath)
  assertShimUsesRealNode(nodeShim)
  assertShimUsesRealNode(pnpmShim)
  writeFileSync(nodeShimPath, nodeShim, { encoding: 'utf8', mode: EXECUTABLE_FILE_MODE })
  writeFileSync(pnpmShimPath, pnpmShim, { encoding: 'utf8', mode: EXECUTABLE_FILE_MODE })
  const clearEnvironmentPath = join(options.stateDir, 'clear-env.mjs')
  writeFileSync(clearEnvironmentPath, 'void 0;\n', { encoding: 'utf8', mode: PRIVATE_FILE_MODE })
  if (!windows) {
    chmodSync(nodeShimPath, EXECUTABLE_FILE_MODE)
    chmodSync(pnpmShimPath, EXECUTABLE_FILE_MODE)
  }

  return {
    pathDir,
    pnpmShimPath,
    nodeBinDir,
    nodeShimPath,
    clearEnvironmentPath,
    dispose: installPathDirectory(options.environment ?? process.env, pathDir, options.platform),
  }
}
