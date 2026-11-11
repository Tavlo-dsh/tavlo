/** Isolated command-line environment launched from the DSH Desktop titlebar / tray. */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, win32 } from 'node:path'
import { assertDesktopProfileName } from './profile-state.ts'
import {
  posixNodeShim,
  posixPnpmShim,
  windowsNodeShim,
  windowsPnpmShim,
} from './node-runtime-environment.ts'
import { EXECUTABLE_FILE_MODE, terminalCommand } from './terminal-launch.ts'
import type { DesktopPlatform } from './types.ts'

const DEFAULT_PROFILE = 'DSH_DESKTOP_DEFAULT_PROFILE'
const DSH_HOME = 'DSH_HOME'
const PATH_KEY = 'PATH'
const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const WINDOWS_APP_EXECUTABLE = 'DSH_DESKTOP_APP_EXECUTABLE'
const WINDOWS_DSH_BOOTSTRAP = 'DSH_DESKTOP_DSH_BOOTSTRAP'
const WINDOWS_ELECTRON_VERSION = 'DSH_DESKTOP_ELECTRON_VERSION'
const WINDOWS_PNPM_ENTRY = 'DSH_DESKTOP_PNPM_ENTRY'
const WINDOWS_PROFILE_DIRECTORY = 'DSH_DESKTOP_PROFILE_DIRECTORY'
const WINDOWS_PRODUCT_VERSION = 'DSH_DESKTOP_PRODUCT_VERSION'
const WINDOWS_SHIM_DIRECTORY = 'DSH_DESKTOP_SHIM_DIRECTORY'
const WINDOWS_POWERSHELL_WELCOME = 'DSH_DESKTOP_POWERSHELL_WELCOME'
const WINDOWS_CMD_WELCOME = 'DSH_DESKTOP_CMD_WELCOME'
const WINDOWS_SHELL_EXECUTABLE = 'DSH_DESKTOP_SHELL_EXECUTABLE'
const WINDOWS_GENERATED_ENVIRONMENT_KEYS = new Set([
  DEFAULT_PROFILE,
  WINDOWS_APP_EXECUTABLE,
  WINDOWS_DSH_BOOTSTRAP,
  WINDOWS_ELECTRON_VERSION,
  WINDOWS_PNPM_ENTRY,
  WINDOWS_PROFILE_DIRECTORY,
  WINDOWS_PRODUCT_VERSION,
  WINDOWS_SHIM_DIRECTORY,
  WINDOWS_POWERSHELL_WELCOME,
  WINDOWS_CMD_WELCOME,
  WINDOWS_SHELL_EXECUTABLE,
])
const WINDOWS_SHELL_COMMANDS = ['pwsh.exe', 'powershell.exe', 'cmd.exe'] as const
const STATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export type WindowsExecutableExists = (filename: string) => boolean
export type WindowsExecutableResolver = (
  command: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  exists: WindowsExecutableExists,
) => string | undefined

export interface DesktopTerminalPrepareOptions {
  readonly platform: DesktopPlatform
  readonly profileName: string
  readonly profileDir: string
  readonly homeDir: string
  readonly stateDir: string
  readonly productVersion: string
  readonly nodeExecutable?: string
  readonly dshBootstrapPath?: string
  readonly pnpmBinPath?: string
  readonly nodeVersion?: string
  readonly environment?: NodeJS.ProcessEnv
  readonly windowsExecutableExists?: WindowsExecutableExists
  readonly windowsExecutableResolver?: WindowsExecutableResolver
}

export interface DesktopTerminalLaunchFiles {
  readonly shimDir: string
  readonly dshShimPath: string
  readonly pnpmShimPath: string
  readonly nodeShimPath: string
  readonly welcomePath: string
  readonly windowsCmdWelcomePath?: string
  readonly launchBrokerPath?: string
  readonly command: readonly string[]
  readonly cwd?: string
  readonly windowsHide?: boolean
  readonly environment?: NodeJS.ProcessEnv
}

export function desktopTerminalStateDirectory(userDataDir: string, profileName: string): string {
  assertScriptValue('user data directory', userDataDir)
  assertDesktopProfileName(profileName)
  const identity = createHash('sha256').update(profileName, 'utf8').digest('hex')
  return join(userDataDir, 'cli', identity)
}

export function quoteSh(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

export function prepareDesktopTerminal(options: DesktopTerminalPrepareOptions): DesktopTerminalLaunchFiles {
  if (options.platform === 'linux') {
    // The upstream product ships no Linux terminal contract: fail loudly
    // instead of silently opening an unconfigured terminal.
    throw new Error('dsh-desktop: terminal is unsupported on linux')
  }
  if (options.platform !== 'darwin' && options.platform !== 'win32') {
    throw new Error(`dsh-desktop: terminal is unsupported on ${options.platform}`)
  }
  assertDesktopProfileName(options.profileName)
  for (const [label, value] of [
    ['profile directory', options.profileDir],
    ['Harness home', options.homeDir],
    ['state directory', options.stateDir],
    ['product version', options.productVersion],
  ] as const) assertScriptValue(label, value)

  prepareStateDirectory(options.stateDir)
  const shimDir = join(options.stateDir, 'bin')
  prepareStateDirectory(shimDir)
  const windows = options.platform === 'win32'
  const dshShimPath = join(shimDir, windows ? 'dsh.cmd' : 'dsh')
  const pnpmShimPath = join(shimDir, windows ? 'pnpm.cmd' : 'pnpm')
  const nodeShimPath = join(shimDir, windows ? 'node.cmd' : 'node')
  const welcomePath = join(options.stateDir, windows ? 'welcome.cmd' : 'welcome.command')
  const bashRcPath = join(options.stateDir, 'bashrc')

  const nodeExecutable = options.nodeExecutable
  const dshBootstrapPath = options.dshBootstrapPath
  const pnpmBinPath = options.pnpmBinPath
  const nodeVersion = options.nodeVersion
  const hasRuntime = nodeExecutable !== undefined
    && dshBootstrapPath !== undefined
    && pnpmBinPath !== undefined
    && nodeVersion !== undefined

  if (hasRuntime) {
    assertScriptValue('node executable', nodeExecutable)
    assertScriptValue('dsh bootstrap', dshBootstrapPath)
    assertScriptValue('pnpm entry', pnpmBinPath)
    assertScriptValue('node version', nodeVersion)
    if (windows) {
      replacePrivateFile(dshShimPath, windowsDshShim(), PRIVATE_FILE_MODE)
      replacePrivateFile(
        pnpmShimPath,
        windowsPnpmShim({ nodeExecutable, pnpmBinPath, nodeVersion }, shimDir, nodeShimPath),
        PRIVATE_FILE_MODE,
      )
      replacePrivateFile(nodeShimPath, windowsNodeShim(nodeExecutable), PRIVATE_FILE_MODE)
    } else {
      replacePrivateFile(dshShimPath, macDshShim(options.profileName, nodeExecutable, dshBootstrapPath), EXECUTABLE_FILE_MODE)
      replacePrivateFile(
        pnpmShimPath,
        posixPnpmShim({ nodeExecutable, pnpmBinPath, nodeVersion }, shimDir, nodeShimPath),
        EXECUTABLE_FILE_MODE,
      )
      replacePrivateFile(nodeShimPath, posixNodeShim(nodeExecutable), EXECUTABLE_FILE_MODE)
    }
  }

  if (windows && hasRuntime) {
    return prepareWindowsTerminalLaunch(options, {
      shimDir,
      dshShimPath,
      pnpmShimPath,
      nodeShimPath,
      welcomePath: join(options.stateDir, 'welcome.ps1'),
      windowsCmdWelcomePath: join(options.stateDir, 'welcome.cmd'),
    })
  }

  if (windows) {
    replacePrivateFile(welcomePath, windowsCmdWelcome(options), PRIVATE_FILE_MODE)
  } else {
    replacePrivateFile(join(options.stateDir, '.zshrc'), macZshRc(options, shimDir), PRIVATE_FILE_MODE)
    replacePrivateFile(bashRcPath, macBashRc(options, shimDir), PRIVATE_FILE_MODE)
    replacePrivateFile(welcomePath, macWelcome(options, shimDir, bashRcPath), EXECUTABLE_FILE_MODE)
  }

  return {
    shimDir,
    dshShimPath,
    pnpmShimPath,
    nodeShimPath,
    welcomePath,
    command: terminalCommand(options.platform, welcomePath),
  }
}

interface WindowsTerminalFiles {
  readonly shimDir: string
  readonly dshShimPath: string
  readonly pnpmShimPath: string
  readonly nodeShimPath: string
  readonly welcomePath: string
  readonly windowsCmdWelcomePath: string
}

interface ResolvedWindowsShell {
  readonly kind: 'powershell' | 'cmd'
  readonly executable: string
}

function prepareWindowsTerminalLaunch(
  options: DesktopTerminalPrepareOptions,
  files: WindowsTerminalFiles,
): DesktopTerminalLaunchFiles {
  const environment = windowsTerminalEnvironment(options, files)
  replacePrivateFile(files.dshShimPath, windowsDshShim(), PRIVATE_FILE_MODE)
  replacePrivateFile(
    files.pnpmShimPath,
    windowsPnpmShim(
      {
        nodeExecutable: options.nodeExecutable ?? '',
        pnpmBinPath: options.pnpmBinPath ?? '',
        nodeVersion: options.nodeVersion ?? '',
      },
      files.shimDir,
      files.nodeShimPath,
    ),
    PRIVATE_FILE_MODE,
  )
  replacePrivateFile(files.nodeShimPath, windowsNodeShim(options.nodeExecutable ?? ''), PRIVATE_FILE_MODE)
  replacePrivateFile(files.welcomePath, windowsPowershellWelcome(), PRIVATE_FILE_MODE)
  replacePrivateFile(files.windowsCmdWelcomePath, windowsCmdWelcomeScript(), PRIVATE_FILE_MODE)

  const shell = resolveWindowsShell(options, environment)
  const processor = resolveWindowsCommandProcessor(options, environment, shell)
  environment[WINDOWS_SHELL_EXECUTABLE] = shell.executable
  const launchBrokerPath = join(options.stateDir, 'launch.cmd')
  replacePrivateFile(launchBrokerPath, windowsLaunchBroker(shell), PRIVATE_FILE_MODE)

  const command = [
    processor,
    '/D',
    '/S',
    '/C',
    basename(launchBrokerPath),
  ]
  assertAsciiScript('launch.cmd', windowsLaunchBroker(shell))
  assertAsciiScript('welcome.ps1', windowsPowershellWelcome())
  assertAsciiScript('welcome.cmd', windowsCmdWelcomeScript())
  return {
    shimDir: files.shimDir,
    dshShimPath: files.dshShimPath,
    pnpmShimPath: files.pnpmShimPath,
    nodeShimPath: files.nodeShimPath,
    welcomePath: files.welcomePath,
    windowsCmdWelcomePath: files.windowsCmdWelcomePath,
    launchBrokerPath,
    command,
    cwd: options.stateDir,
    windowsHide: true,
    environment,
  }
}

/** Copy the Host environment and scope desktop command discovery to one terminal child. */
function windowsTerminalEnvironment(
  options: DesktopTerminalPrepareOptions,
  files: WindowsTerminalFiles,
): NodeJS.ProcessEnv {
  const source = options.environment ?? process.env
  const env: NodeJS.ProcessEnv = {}
  let inheritedPath: string | undefined
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    const normalized = key.toUpperCase()
    if (normalized === RUN_AS_NODE || normalized === DSH_HOME) continue
    if (WINDOWS_GENERATED_ENVIRONMENT_KEYS.has(normalized)) continue
    if (normalized === PATH_KEY) {
      inheritedPath ??= value
      continue
    }
    env[key] = value
  }
  env.PATH = inheritedPath === undefined || inheritedPath.length === 0
    ? files.shimDir
    : `${files.shimDir};${inheritedPath}`
  env[DSH_HOME] = options.homeDir
  env[DEFAULT_PROFILE] = options.profileName
  env[WINDOWS_APP_EXECUTABLE] = options.nodeExecutable ?? ''
  env[WINDOWS_DSH_BOOTSTRAP] = options.dshBootstrapPath ?? ''
  env[WINDOWS_ELECTRON_VERSION] = options.nodeVersion ?? ''
  env[WINDOWS_PNPM_ENTRY] = options.pnpmBinPath ?? ''
  env[WINDOWS_PROFILE_DIRECTORY] = options.profileDir
  env[WINDOWS_PRODUCT_VERSION] = options.productVersion
  env[WINDOWS_SHIM_DIRECTORY] = files.shimDir
  env[WINDOWS_POWERSHELL_WELCOME] = files.welcomePath
  env[WINDOWS_CMD_WELCOME] = files.windowsCmdWelcomePath
  return env
}

/** Read one Windows environment value without trusting its key casing. */
function windowsEnvironmentValue(environment: Readonly<NodeJS.ProcessEnv>, name: string): string | undefined {
  const normalized = name.toUpperCase()
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === normalized) return value
  }
  return undefined
}

/** Resolve known Windows shells from explicit system paths and then the inherited PATH. */
function defaultWindowsExecutableResolver(
  command: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  exists: WindowsExecutableExists,
): string | undefined {
  const candidates: string[] = []
  const systemRoot = windowsEnvironmentValue(environment, 'SystemRoot')
  if (command.toLowerCase() === 'powershell.exe' && systemRoot !== undefined) {
    candidates.push(win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  }
  if (command.toLowerCase() === 'cmd.exe') {
    const comSpec = windowsEnvironmentValue(environment, 'ComSpec')
    if (comSpec !== undefined) candidates.push(comSpec)
    if (systemRoot !== undefined) candidates.push(win32.join(systemRoot, 'System32', 'cmd.exe'))
  }
  const inheritedPath = windowsEnvironmentValue(environment, PATH_KEY)
  if (inheritedPath !== undefined) {
    for (const rawDir of inheritedPath.split(';')) {
      const dir = rawDir.startsWith('"') && rawDir.endsWith('"') ? rawDir.slice(1, -1) : rawDir
      if (dir.length > 0) candidates.push(win32.join(dir, command))
    }
  }
  return candidates.find(candidate => exists(candidate))
}

/** Select PowerShell 7, Windows PowerShell, or the built-in command prompt. */
function resolveWindowsShell(
  options: DesktopTerminalPrepareOptions,
  environment: Readonly<NodeJS.ProcessEnv>,
): ResolvedWindowsShell {
  const exists = options.windowsExecutableExists ?? existsSync
  const resolveExecutable = options.windowsExecutableResolver ?? defaultWindowsExecutableResolver
  for (const command of WINDOWS_SHELL_COMMANDS) {
    const executable = resolveExecutable(command, environment, exists)
    if (executable === undefined) continue
    assertScriptValue(`${command} executable`, executable)
    return {
      kind: command === 'cmd.exe' ? 'cmd' : 'powershell',
      executable,
    }
  }
  throw new Error('dsh-desktop: terminal requires pwsh.exe, powershell.exe, or cmd.exe on Windows')
}

/** Resolve the trusted command processor used only to invoke the `start` broker. */
function resolveWindowsCommandProcessor(
  options: DesktopTerminalPrepareOptions,
  environment: Readonly<NodeJS.ProcessEnv>,
  shell: ResolvedWindowsShell,
): string {
  if (shell.kind === 'cmd') return shell.executable
  const exists = options.windowsExecutableExists ?? existsSync
  const resolveExecutable = options.windowsExecutableResolver ?? defaultWindowsExecutableResolver
  const executable = resolveExecutable('cmd.exe', environment, exists)
  if (executable === undefined) {
    throw new Error('dsh-desktop: terminal requires cmd.exe to create a visible Windows console')
  }
  assertScriptValue('cmd.exe executable', executable)
  return executable
}

/** Build the trusted batch broker whose `start` command owns the visible console. */
function windowsLaunchBroker(shell: ResolvedWindowsShell): string {
  const target = shell.kind === 'cmd'
    ? `"!${WINDOWS_SHELL_EXECUTABLE}!" /D /K call "!${WINDOWS_CMD_WELCOME}!"`
    : `"!${WINDOWS_SHELL_EXECUTABLE}!" -NoLogo -NoExit -ExecutionPolicy Bypass -File "!${WINDOWS_POWERSHELL_WELCOME}!"`
  return [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    `start "DSH Desktop" /D "!${WINDOWS_PROFILE_DIRECTORY}!" ${target}`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

/** Build the PowerShell script that remains active in the new console. */
function windowsPowershellWelcome(): string {
  const commandHelp = 'dsh --dump-config'
  const pluginAdd = 'dsh plugin add <third-party-plugin>'
  const pluginRemove = 'dsh plugin remove <third-party-plugin>'
  const pluginUpdate = 'dsh plugin update'
  return [
    `$dshDesktopShimDir = $env:${WINDOWS_SHIM_DIRECTORY}`,
    `$dshDesktopPath = @($env:PATH -split ';' | Where-Object { -not [string]::Equals($_, $dshDesktopShimDir, [StringComparison]::OrdinalIgnoreCase) })`,
    `$env:PATH = (@($dshDesktopShimDir) + $dshDesktopPath) -join ';'`,
    `Set-Location -LiteralPath $env:${WINDOWS_PROFILE_DIRECTORY}`,
    `Write-Host ("DSH Desktop {0} terminal" -f $env:${WINDOWS_PRODUCT_VERSION})`,
    `Write-Host ("Profile: {0}" -f $env:${DEFAULT_PROFILE})`,
    `Write-Host ("Profile directory: {0}" -f $env:${WINDOWS_PROFILE_DIRECTORY})`,
    `Write-Host ("Harness home: {0}" -f $env:${DSH_HOME})`,
    `Write-Host ("Plugin commands without --profile modify the {0} profile." -f $env:${DEFAULT_PROFILE})`,
    `Write-Host 'Commands:'`,
    `Write-Host '  ${commandHelp}'`,
    `Write-Host '  ${pluginAdd}'`,
    `Write-Host '  ${pluginRemove}'`,
    `Write-Host '  ${pluginUpdate}'`,
    `Write-Host 'Restart DSH Desktop after plugin changes.'`,
    '',
  ].join('\r\n')
}

/** Build the fallback batch welcome script used when PowerShell is unavailable. */
function windowsCmdWelcomeScript(): string {
  const commandHelp = 'dsh --dump-config'
  const pluginAdd = 'dsh plugin add <third-party-plugin>'
  const pluginRemove = 'dsh plugin remove <third-party-plugin>'
  const pluginUpdate = 'dsh plugin update'
  return [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    `cd /d "!${WINDOWS_PROFILE_DIRECTORY}!"`,
    `echo(DSH Desktop !${WINDOWS_PRODUCT_VERSION}! terminal`,
    `echo(Profile: !${DEFAULT_PROFILE}!`,
    `echo(Profile directory: !${WINDOWS_PROFILE_DIRECTORY}!`,
    `echo(Harness home: !${DSH_HOME}!`,
    `echo(Plugin commands without --profile modify the !${DEFAULT_PROFILE}! profile.`,
    'echo(Commands:',
    `echo(  ${commandHelp}`,
    `echo(  ${pluginAdd}`,
    `echo(  ${pluginRemove}`,
    `echo(  ${pluginUpdate}`,
    'echo(Restart DSH Desktop after plugin changes.',
    '',
  ].join('\r\n')
}

/** Windows scripts stay pure ASCII: localized paths only travel through environment variables. */
function assertAsciiScript(label: string, contents: string): void {
  if (!/^[\x00-\x7F]*$/u.test(contents)) {
    throw new Error(`dsh-desktop: terminal ${label} must stay ASCII`)
  }
}

function assertScriptValue(label: string, value: string): void {
  if (value.length === 0) throw new Error(`dsh-desktop: terminal ${label} must not be empty`)
  if (/[\0\r\n]/u.test(value)) {
    throw new Error(`dsh-desktop: terminal ${label} must not contain NUL or newlines`)
  }
}

function replacePrivateFile(filename: string, contents: string, mode: number): void {
  const temporary = join(dirname(filename), `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx', mode })
    chmodSync(temporary, mode)
    renameSync(temporary, filename)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
}

function prepareStateDirectory(stateDir: string): void {
  mkdirSync(stateDir, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const stat = lstatSync(stateDir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`dsh-desktop: terminal state path is not a private directory: ${stateDir}`)
  }
  chmodSync(stateDir, STATE_DIRECTORY_MODE)
}

function macDshShim(profileName: string, nodeExecutable: string, dshBootstrapPath: string): string {
  return [
    '#!/bin/sh',
    [
      `${DEFAULT_PROFILE}=${quoteSh(profileName)}`,
      `exec ${quoteSh(nodeExecutable)} --expose-internals ${quoteSh(dshBootstrapPath)} "$@"`,
    ].join(' '),
    '',
  ].join('\n')
}

function windowsDshShim(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `"%DSH_DESKTOP_NODE_EXECUTABLE%" --expose-internals "%DSH_DESKTOP_DSH_BOOTSTRAP%" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

function macZshRc(options: DesktopTerminalPrepareOptions, shimDir: string): string {
  return [
    'if [[ -n "${DSH_DESKTOP_USER_ZDOTDIR:-}" && -r "${DSH_DESKTOP_USER_ZDOTDIR}/.zshrc" ]]; then',
    '  ZDOTDIR="${DSH_DESKTOP_USER_ZDOTDIR}"',
    '  source "${DSH_DESKTOP_USER_ZDOTDIR}/.zshrc"',
    'fi',
    `export ${DSH_HOME}=${quoteSh(options.homeDir)}`,
    'typeset -U path',
    `path=(${quoteSh(shimDir)} $path)`,
    'export PATH',
    'unset DSH_DESKTOP_USER_ZDOTDIR',
    '',
  ].join('\n')
}

function macBashRc(options: DesktopTerminalPrepareOptions, shimDir: string): string {
  return [
    'if [ -n "${DSH_DESKTOP_USER_BASHRC:-}" ] && [ -r "${DSH_DESKTOP_USER_BASHRC}" ]; then',
    '  . "${DSH_DESKTOP_USER_BASHRC}"',
    'fi',
    `export ${DSH_HOME}=${quoteSh(options.homeDir)}`,
    'case ":${PATH:-}:" in',
    `  *:${quoteSh(shimDir)}:*) ;;`,
    `  *) export PATH=${quoteSh(shimDir)}:"\${PATH:-}" ;;`,
    'esac',
    'unset DSH_DESKTOP_USER_BASHRC',
    '',
  ].join('\n')
}

function macWelcome(
  options: DesktopTerminalPrepareOptions,
  shimDir: string,
  bashRcPath: string,
): string {
  const commandHelp = 'dsh --dump-config'
  const pluginAdd = 'dsh plugin add <third-party-plugin>'
  const pluginRemove = 'dsh plugin remove <third-party-plugin>'
  const pluginUpdate = 'dsh plugin update'
  return [
    '#!/bin/sh',
    `export ${DSH_HOME}=${quoteSh(options.homeDir)}`,
    `export PATH=${quoteSh(shimDir)}:"\${PATH:-}"`,
    `cd ${quoteSh(options.profileDir)}`,
    "printf '\\033[2J\\033[3J\\033[H'",
    `printf '%s\\n' ${quoteSh(`DSH Desktop ${options.productVersion} terminal`)}`,
    `printf '%s\\n' ${quoteSh(`Profile: ${options.profileName}`)}`,
    `printf '%s\\n' ${quoteSh(`Profile directory: ${options.profileDir}`)}`,
    `printf '%s\\n' ${quoteSh(`Harness home: ${options.homeDir}`)}`,
    `printf '%s\\n' ${quoteSh(`Plugin commands without --profile modify the ${options.profileName} profile.`)}`,
    `printf '%s\\n' ${quoteSh('Commands:')}`,
    `printf '  %s\\n' ${quoteSh(commandHelp)}`,
    `printf '  %s\\n' ${quoteSh(pluginAdd)}`,
    `printf '  %s\\n' ${quoteSh(pluginRemove)}`,
    `printf '  %s\\n' ${quoteSh(pluginUpdate)}`,
    `printf '%s\\n' ${quoteSh('Restart DSH Desktop after plugin changes.')}`,
    'case "${SHELL:-/bin/zsh}" in',
    '  */bash)',
    '    export DSH_DESKTOP_USER_BASHRC="${HOME:-}/.bashrc"',
    `    exec "\${SHELL}" --noprofile --rcfile ${quoteSh(bashRcPath)} -i`,
    '    ;;',
    '  */zsh)',
    '    export DSH_DESKTOP_USER_ZDOTDIR="${ZDOTDIR:-${HOME:-}}"',
    `    export ZDOTDIR=${quoteSh(options.stateDir)}`,
    '    exec "${SHELL}" -i',
    '    ;;',
    '  *)',
    '    export DSH_DESKTOP_USER_ZDOTDIR="${ZDOTDIR:-${HOME:-}}"',
    `    export ZDOTDIR=${quoteSh(options.stateDir)}`,
    '    exec /bin/zsh -i',
    '    ;;',
    'esac',
    '',
  ].join('\n')
}

function windowsCmdWelcome(options: DesktopTerminalPrepareOptions): string {
  const commandHelp = 'dsh --dump-config'
  const pluginAdd = 'dsh plugin add <third-party-plugin>'
  const pluginRemove = 'dsh plugin remove <third-party-plugin>'
  const pluginUpdate = 'dsh plugin update'
  return [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    `cd /d ${options.profileDir}`,
    `echo(DSH Desktop ${options.productVersion} terminal`,
    `echo(Profile: ${options.profileName}`,
    `echo(Profile directory: ${options.profileDir}`,
    `echo(Harness home: ${options.homeDir}`,
    `echo(Plugin commands without --profile modify the ${options.profileName} profile.`,
    'echo(Commands:',
    `echo(  ${commandHelp}`,
    `echo(  ${pluginAdd}`,
    `echo(  ${pluginRemove}`,
    `echo(  ${pluginUpdate}`,
    'echo(Restart DSH Desktop after plugin changes.',
    '',
  ].join('\r\n')
}
