import { spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopTerminalStateDirectory,
  prepareDesktopTerminal,
} from '../src/runtime/desktop-terminal.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-terminal-'))
  temporaryDirectories.push(dir)
  return dir
}

function macOptions(stateDir: string) {
  return {
    platform: 'darwin' as const,
    nodeExecutable: "/usr/local/bin/node O'Brien",
    dshBootstrapPath: "/Applications/DSH O'Brien.app/Contents/Resources/host/desktop-cli.js",
    pnpmBinPath: "/Applications/DSH O'Brien.app/Contents/Resources/node_modules/pnpm/bin/pnpm.mjs",
    nodeVersion: '22.20.0',
    profileName: 'desktop',
    productVersion: '2.0.0',
    profileDir: "/Users/example/Library/Application Support/DSH O'Brien/profiles/desktop",
    homeDir: "/Users/example/Library/Application Support/DSH O'Brien",
    stateDir,
  }
}

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('desktop terminal environment', () => {
  it('keeps generated shims isolated by active profile', () => {
    const desktop = desktopTerminalStateDirectory('/tmp/dsh-desktop', 'desktop')
    const work = desktopTerminalStateDirectory('/tmp/dsh-desktop', '工作 profile')

    expect(dirname(desktop)).toBe(join('/tmp/dsh-desktop', 'cli'))
    expect(dirname(work)).toBe(join('/tmp/dsh-desktop', 'cli'))
    expect(basename(desktop)).toMatch(/^[a-f0-9]{64}$/u)
    expect(basename(work)).toMatch(/^[a-f0-9]{64}$/u)
    expect(work).not.toBe(desktop)
    expect(desktopTerminalStateDirectory('/tmp/dsh-desktop', 'desktop')).toBe(desktop)
  })

  it('generates private macOS shims and one quoted welcome command using real Node', () => {
    const stateDir = join(temporaryDirectory(), 'terminal state')
    const options = macOptions(stateDir)
    const launch = prepareDesktopTerminal(options)

    expect(launch).toMatchObject({
      shimDir: join(stateDir, 'bin'),
      dshShimPath: join(stateDir, 'bin', 'dsh'),
      pnpmShimPath: join(stateDir, 'bin', 'pnpm'),
      nodeShimPath: join(stateDir, 'bin', 'node'),
      welcomePath: join(stateDir, 'welcome.command'),
    })
    expect(launch.command).toEqual(['open', '-a', 'Terminal', launch.welcomePath])
    if (process.platform !== 'win32') {
      expect(lstatSync(stateDir).mode & 0o777).toBe(0o700)
      expect(lstatSync(launch.shimDir).mode & 0o777).toBe(0o700)
      for (const filename of [launch.dshShimPath, launch.pnpmShimPath, launch.nodeShimPath, launch.welcomePath]) {
        expect(lstatSync(filename).mode & 0o777).toBe(0o700)
      }
    }

    const dshShim = readFileSync(launch.dshShimPath, 'utf8')
    expect(dshShim).toContain("DSH_DESKTOP_DEFAULT_PROFILE='desktop' exec")
    expect(dshShim).toContain('--expose-internals')
    expect(dshShim).toContain("/usr/local/bin/node O'\"'\"'Brien")
    expect(dshShim).toContain("'/Applications/DSH O'\"'\"'Brien.app/Contents/Resources/host/desktop-cli.js'")
    expect(dshShim).toContain('"$@"')
    expect(dshShim).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(dshShim).not.toContain('npm_config_')
    const pnpmShim = readFileSync(launch.pnpmShimPath, 'utf8')
    expect(pnpmShim).toContain('npm_config_runtime=node')
    expect(pnpmShim).toContain("npm_config_target='22.20.0'")
    expect(pnpmShim).not.toContain('ELECTRON_RUN_AS_NODE')
    expect(pnpmShim).not.toContain('electronjs.org/headers')
    const nodeShim = readFileSync(launch.nodeShimPath, 'utf8')
    expect(nodeShim).toContain("exec '/usr/local/bin/node O'\"'\"'Brien' \"$@\"")
    expect(nodeShim).not.toContain('ELECTRON_RUN_AS_NODE')

    const welcome = readFileSync(launch.welcomePath, 'utf8')
    expect(welcome).toContain("printf '\\033[2J\\033[3J\\033[H'")
    expect(welcome).toContain('DSH Desktop 2.0.0 terminal')
    expect(welcome).toContain('Profile: desktop')
    expect(welcome).toContain('Plugin commands without --profile modify the desktop profile.')
    expect(welcome).toContain('dsh --dump-config')
    expect(welcome).toContain('dsh plugin add <third-party-plugin>')
    expect(welcome).toContain('dsh plugin remove <third-party-plugin>')
    expect(welcome).toContain('dsh plugin update')
    expect(welcome).toContain('Restart DSH Desktop after plugin changes.')
    expect(welcome).not.toContain(' -l')
    expect(welcome).toContain("DSH O'\"'\"'Brien")
    expect(welcome).toContain('exec "${SHELL}" --noprofile --rcfile')
    expect(welcome).toContain('exec "${SHELL}" -i')
    expect(welcome).not.toContain('ELECTRON_RUN_AS_NODE=1')

    const zshRc = readFileSync(join(stateDir, '.zshrc'), 'utf8')
    expect(zshRc).toContain('source "${DSH_DESKTOP_USER_ZDOTDIR}/.zshrc"')
    expect(zshRc).toContain(`path=('${launch.shimDir}' $path)`)
    const bashRc = readFileSync(join(stateDir, 'bashrc'), 'utf8')
    expect(bashRc).toContain('. "${DSH_DESKTOP_USER_BASHRC}"')
    expect(bashRc.indexOf('. "${DSH_DESKTOP_USER_BASHRC}"')).toBeLessThan(
      bashRc.indexOf(`export PATH='${launch.shimDir}'`),
    )
    if (process.platform === 'darwin') {
      expect(spawnSync('/bin/sh', ['-n', launch.dshShimPath]).status).toBe(0)
      expect(spawnSync('/bin/sh', ['-n', launch.pnpmShimPath]).status).toBe(0)
      expect(spawnSync('/bin/sh', ['-n', launch.nodeShimPath]).status).toBe(0)
      expect(spawnSync('/bin/sh', ['-n', launch.welcomePath]).status).toBe(0)
      expect(spawnSync('/bin/zsh', ['-n', join(stateDir, '.zshrc')]).status).toBe(0)
      expect(spawnSync('/bin/bash', ['-n', join(stateDir, 'bashrc')]).status).toBe(0)
    }
  })

  it('accepts localized macOS profile names and rejects path escapes before writing state', () => {
    const root = temporaryDirectory()
    const unsafe = macOptions(join(root, 'unsafe'))
    unsafe.profileName = '../desktop'
    expect(() => prepareDesktopTerminal(unsafe)).toThrow('invalid desktop profile name')
    expect(() => lstatSync(unsafe.stateDir)).toThrow()

    const localized = macOptions(join(root, 'localized'))
    localized.profileName = '工作 profile'
    const launch = prepareDesktopTerminal(localized)
    expect(readFileSync(launch.welcomePath, 'utf8')).toContain('Profile: 工作 profile')

    const newline = macOptions(join(root, 'newline'))
    newline.productVersion = '2.0.0\ntouch injected'
    expect(() => prepareDesktopTerminal(newline)).toThrow('must not contain NUL or newlines')
    expect(() => lstatSync(newline.stateDir)).toThrow()
  })

  it('fails on linux without creating any state directory', () => {
    const root = temporaryDirectory()
    const options = {
      ...macOptions(join(root, 'linux')),
      platform: 'linux' as const,
    }
    expect(() => prepareDesktopTerminal(options)).toThrow('terminal is unsupported on linux')
    expect(() => lstatSync(options.stateDir)).toThrow()
  })
})

describe('windows terminal broker', () => {
  function windowsOptions(stateDir: string, overrides: Partial<Record<string, unknown>> = {}) {
    return {
      platform: 'win32' as const,
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe',
      dshBootstrapPath: 'C:\\Users\\示例\\AppData\\Local\\DSH Desktop\\desktop-cli.js',
      pnpmBinPath: 'C:\\Users\\示例\\AppData\\Local\\DSH Desktop\\pnpm.mjs',
      nodeVersion: '22.20.0',
      profileName: 'desktop',
      productVersion: '2.0.0',
      profileDir: 'C:\\Users\\示例\\工作区',
      homeDir: 'C:\\Users\\示例\\.dsh',
      stateDir,
      environment: {
        SystemRoot: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        PATH: 'C:\\Windows;C:\\Windows\\System32',
        DSH_HOME: 'stale-inherited',
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP_PROFILE_DIRECTORY: 'stale-generated',
      },
      ...overrides,
    }
  }

  function resolverReturning(available: Record<'pwsh.exe' | 'powershell.exe' | 'cmd.exe', string | undefined>) {
    const probed: string[] = []
    return {
      probed,
      resolver: (command: string) => {
        probed.push(command)
        return available[command as keyof typeof available]
      },
    }
  }

  it('probes pwsh, then powershell, then cmd', () => {
    const stateDir = join(temporaryDirectory(), 'broker')
    const { probed, resolver } = resolverReturning({ 'pwsh.exe': undefined, 'powershell.exe': undefined, 'cmd.exe': 'C:\\Windows\\System32\\cmd.exe' })
    const launch = prepareDesktopTerminal(windowsOptions(stateDir, { windowsExecutableResolver: resolver }))
    expect(probed).toEqual(['pwsh.exe', 'powershell.exe', 'cmd.exe'])
    expect(launch.command[0]).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(launch.command.slice(1)).toEqual(['/D', '/S', '/C', 'launch.cmd'])
    expect(launch.cwd).toBe(stateDir)
    expect(launch.windowsHide).toBe(true)
  })

  it('throws when no Windows shell resolves', () => {
    const stateDir = join(temporaryDirectory(), 'missing')
    const options = windowsOptions(stateDir, {
      windowsExecutableResolver: () => undefined,
    })
    expect(() => prepareDesktopTerminal(options)).toThrow(
      'terminal requires pwsh.exe, powershell.exe, or cmd.exe on Windows',
    )
  })

  it('requires cmd.exe to broker a PowerShell launch', () => {
    const stateDir = join(temporaryDirectory(), 'nocomd')
    const options = windowsOptions(stateDir, {
      windowsExecutableResolver: (command: string) =>
        command === 'pwsh.exe' ? 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' : undefined,
    })
    expect(() => prepareDesktopTerminal(options)).toThrow(
      'terminal requires cmd.exe to create a visible Windows console',
    )
  })

  it('writes the PowerShell launch broker and stays ASCII despite localized paths', () => {
    const stateDir = join(temporaryDirectory(), 'ps')
    const { resolver } = resolverReturning({
      'pwsh.exe': undefined,
      'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'cmd.exe': 'C:\\Windows\\System32\\cmd.exe',
    })
    const launch = prepareDesktopTerminal(windowsOptions(stateDir, { windowsExecutableResolver: resolver }))

    expect(launch.welcomePath.endsWith('welcome.ps1')).toBe(true)
    expect(launch.windowsCmdWelcomePath?.endsWith('welcome.cmd')).toBe(true)
    expect(launch.launchBrokerPath?.endsWith('launch.cmd')).toBe(true)
    const broker = readFileSync(launch.launchBrokerPath ?? '', 'utf8')
    expect(broker).toContain('start "DSH Desktop" /D "!DSH_DESKTOP_PROFILE_DIRECTORY!"')
    expect(broker).toContain('"!DSH_DESKTOP_SHELL_EXECUTABLE!" -NoLogo -NoExit -ExecutionPolicy Bypass -File "!DSH_DESKTOP_POWERSHELL_WELCOME!"')
    expect(broker).toContain('exit /b %errorlevel%')
    expect(broker.endsWith('\r\n')).toBe(true)

    const powershellWelcome = readFileSync(launch.welcomePath, 'utf8')
    expect(powershellWelcome).toContain('Set-Location -LiteralPath $env:DSH_DESKTOP_PROFILE_DIRECTORY')
    expect(powershellWelcome).toContain('"Plugin commands without --profile modify the {0} profile."')
    expect(powershellWelcome).toContain('dsh --dump-config')
    const cmdWelcome = readFileSync(launch.windowsCmdWelcomePath ?? '', 'utf8')
    expect(cmdWelcome).toContain('cd /d "!DSH_DESKTOP_PROFILE_DIRECTORY!"')

    // Scripts stay pure ASCII even though profile paths contain localized characters.
    for (const script of [broker, powershellWelcome, cmdWelcome]) {
      expect(script).toMatch(/^[\x00-\x7F]*$/u)
    }
    if (process.platform !== 'win32') {
      for (const filename of [launch.dshShimPath, launch.pnpmShimPath, launch.nodeShimPath, launch.welcomePath, launch.windowsCmdWelcomePath ?? '', launch.launchBrokerPath ?? '']) {
        expect(lstatSync(filename).mode & 0o777).toBe(0o600)
      }
    }
  })

  it('targets the cmd welcome when the shell is the command prompt', () => {
    const stateDir = join(temporaryDirectory(), 'cmdshell')
    const { resolver } = resolverReturning({
      'pwsh.exe': undefined,
      'powershell.exe': undefined,
      'cmd.exe': 'C:\\Windows\\System32\\cmd.exe',
    })
    const launch = prepareDesktopTerminal(windowsOptions(stateDir, { windowsExecutableResolver: resolver }))
    const broker = readFileSync(launch.launchBrokerPath ?? '', 'utf8')
    expect(broker).toContain('"!DSH_DESKTOP_SHELL_EXECUTABLE!" /D /K call "!DSH_DESKTOP_CMD_WELCOME!"')
  })

  it('builds the environment contract with shim-first PATH and generated keys', () => {
    const stateDir = join(temporaryDirectory(), 'env')
    const { resolver } = resolverReturning({
      'pwsh.exe': undefined,
      'powershell.exe': 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'cmd.exe': 'C:\\Windows\\System32\\cmd.exe',
    })
    const launch = prepareDesktopTerminal(windowsOptions(stateDir, { windowsExecutableResolver: resolver }))
    const environment = launch.environment ?? {}
    expect(environment.PATH).toBe(`${launch.shimDir};C:\\Windows;C:\\Windows\\System32`)
    expect(environment.DSH_HOME).toBe('C:\\Users\\示例\\.dsh')
    expect(environment.DSH_DESKTOP_DEFAULT_PROFILE).toBe('desktop')
    expect(environment.DSH_DESKTOP_APP_EXECUTABLE).toBe('C:\\Program Files\\nodejs\\node.exe')
    expect(environment.DSH_DESKTOP_ELECTRON_VERSION).toBe('22.20.0')
    expect(environment.DSH_DESKTOP_PROFILE_DIRECTORY).toBe('C:\\Users\\示例\\工作区')
    expect(environment.DSH_DESKTOP_PRODUCT_VERSION).toBe('2.0.0')
    expect(environment.DSH_DESKTOP_SHIM_DIRECTORY).toBe(launch.shimDir)
    expect(environment.DSH_DESKTOP_POWERSHELL_WELCOME).toBe(launch.welcomePath)
    expect(environment.DSH_DESKTOP_CMD_WELCOME).toBe(launch.windowsCmdWelcomePath)
    expect(environment.DSH_DESKTOP_SHELL_EXECUTABLE)
      .toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(environment.DSH_DESKTOP_PROFILE_DIRECTORY).not.toBe('stale-generated')
  })

  it('resolves system shells from SystemRoot, ComSpec, and PATH', () => {
    const stateDir = join(temporaryDirectory(), 'default-resolver')
    const found: string[] = []
    const options = windowsOptions(stateDir, {
      windowsExecutableExists: (filename: string) => {
        found.push(filename)
        return filename.toLowerCase().endsWith('windowspowershell\\v1.0\\powershell.exe')
          || filename.toLowerCase().endsWith('system32\\cmd.exe')
      },
    })
    const launch = prepareDesktopTerminal(options)
    expect(launch.environment?.DSH_DESKTOP_SHELL_EXECUTABLE)
      .toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(found).toContain('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })
})
