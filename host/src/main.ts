import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NATIVE_EVENTS } from './rpc/protocol.ts'
import { createStdioTransport } from './rpc/stdio.ts'
import type { RpcTransport } from './rpc/transport.ts'
import { DEFAULT_WINDOW_HEIGHT, DEFAULT_WINDOW_WIDTH, DEFAULT_MIN_HEIGHT, DEFAULT_MIN_WIDTH, PRODUCT_NAME } from './host/constants.ts'
import { startLoopbackCarrier } from './host/loopback.ts'
import { isDevToolsEnabled } from './runtime/build-profile.ts'
import { writeListenManifest } from './runtime/listen-manifest.ts'
import { LogJournal } from './runtime/log-journal.ts'
import { NetworkJournal } from './runtime/network-journal.ts'
import { IpcDesktopRuntime } from './runtime/ipc-desktop-runtime.ts'
import { desktopTrayLabel } from './runtime/dialog-copy.ts'
import { loadNativeBootstrap, writeNativeBootstrap } from './runtime/native-bootstrap.ts'
import { installBunHostCompat } from './runtime/bun-host-compat.ts'
import { installDesktopNodeRuntime } from './runtime/node-runtime-environment.ts'
import { officialHostEntry } from './runtime/official-host.ts'
import { defaultDesktopUserDataDirectory, defaultDshHome, dshPluginDesktopRoot } from './runtime/paths.ts'
import { loadProfileState, profileSelectionStatePath } from './runtime/profile-state.ts'
import { effectiveDesktopWindowMaterial, parseMacosWindowMaterial, parseWindowsWindowMaterial, windowsBuildNumber } from './runtime/window-material.ts'
import type { DesktopPlatform, DesktopShellPayload } from './runtime/types.ts'

export interface HostMainOptions {
  readonly transport: RpcTransport
  readonly userDataDir?: string
  readonly recovery?: boolean
  readonly platform?: DesktopPlatform
  readonly nodeExecutable?: string
  readonly pnpmBinPath?: string
  readonly environment?: NodeJS.ProcessEnv
}

export interface HostMainHandle {
  readonly url: string
  readonly profileName: string
  readonly runtime: IpcDesktopRuntime
  stop(): Promise<void>
}

function platformOf(value: NodeJS.Platform | DesktopPlatform): DesktopPlatform {
  if (value === 'darwin' || value === 'win32' || value === 'linux') return value
  return 'linux'
}

export async function runHostMain(options: HostMainOptions): Promise<HostMainHandle> {
  const platform = options.platform ?? platformOf(process.platform)
  const userDataDir = options.userDataDir ?? defaultDesktopUserDataDirectory(platform)
  mkdirSync(userDataDir, { recursive: true })
  const profileState = loadProfileState(profileSelectionStatePath(userDataDir))
  const bootstrap = loadNativeBootstrap(userDataDir)
  const profileName = profileState.state.active
  const homeDir = defaultDshHome(platform, options.environment)
  const windowsBuild = platform === 'win32' ? windowsBuildNumber() : undefined
  const runtime = new IpcDesktopRuntime(options.transport, {
    platform,
    userDataDir,
    ...(windowsBuild === undefined ? {} : { windowsBuild }),
  })

  if (options.recovery) {
    await runtime.openRecovery({
      locale: runtime.locale,
      failureStage: 'runtime-bootstrap',
      failureDetail: 'Recovery mode was requested.',
      requested: true,
      profileName,
    })
  }

  const environment = options.environment ?? process.env
  const devtoolsEnabled = isDevToolsEnabled(environment)
  const logs = new LogJournal(userDataDir, devtoolsEnabled)
  const network = new NetworkJournal(userDataDir, devtoolsEnabled)
  logs.append({ level: 'info', source: 'host', message: 'Host starting', data: { profileName, devtoolsEnabled } })

  const pnpmBinPath = options.pnpmBinPath ?? environment.DSH_PNPM_BIN
  const nodeRuntime = pnpmBinPath === undefined ? undefined : installDesktopNodeRuntime({
    platform,
    nodeExecutable: options.nodeExecutable ?? process.execPath,
    pnpmBinPath,
    nodeVersion: process.versions.node,
    stateDir: join(userDataDir, 'runtime-commands'),
    environment,
  })

  let carrier
  try {
    carrier = await startLoopbackCarrier({
      pageTitle: PRODUCT_NAME,
      devtools: { enabled: devtoolsEnabled, logs, network },
      onRendererBootReport: report => { runtime.reportRendererBoot(report) },
    })
  } catch (cause) {
    options.transport.notify(NATIVE_EVENTS.sidecarFailed, {
      stage: 'host-boot',
      message: cause instanceof Error ? cause.message : String(cause),
    })
    throw cause
  }
  logs.append({ level: 'info', source: 'host', message: 'loopback bound', data: { origin: carrier.origin } })
  writeListenManifest(userDataDir, {
    version: 1,
    enabled: devtoolsEnabled,
    logsPath: logs.filePath,
    networkPath: network.filePath,
    http: devtoolsEnabled
      ? {
          origin: carrier.origin,
          logs: `${carrier.origin}/_dsh/dev/logs`,
          network: `${carrier.origin}/_dsh/dev/network`,
          ui: `${carrier.origin}/_dsh/dev/ui`,
          meta: `${carrier.origin}/_dsh/dev/meta`,
        }
      : null,
  })

  runtime.configureTerminal({
    profileName,
    profileDir: join(homeDir, 'profiles', profileName),
    homeDir,
  })

  const payload: DesktopShellPayload = {
    mode: bootstrap.mode,
    macosMaterial: parseMacosWindowMaterial(undefined),
    windowsMaterial: parseWindowsWindowMaterial(undefined),
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: DEFAULT_MIN_WIDTH,
    minHeight: DEFAULT_MIN_HEIGHT,
    material: effectiveDesktopWindowMaterial(
      bootstrap.mode,
      platform,
      parseMacosWindowMaterial(undefined),
      parseWindowsWindowMaterial(undefined),
      runtime.windowsBuild,
    ),
    url: carrier.url,
    productName: PRODUCT_NAME,
    windowTitle: PRODUCT_NAME,
    iconPath: '',
    trayIcons: { templatePath: '', bluePath: '' },
    locale: runtime.locale,
    themeSource: 'system',
  }

  const release = runtime.schedule(payload)
  // The placeholder page reports boot health over the loopback POST route;
  // the official Host path blocks on its own DesktopRendererHealthGate instead.
  const rendererBoot = runtime.beginRendererBootMonitoring(
    { commitHealthy: async () => undefined },
    30_000,
  )
  void rendererBoot.then(
    verdict => {
      if ('failureReason' in verdict) {
        logs.append({
          level: 'error',
          source: 'host',
          message: 'renderer boot failed',
          data: { reason: verdict.failureReason },
        })
      }
    },
    () => undefined,
  )
  await runtime.mountScheduled(() => {
    writeNativeBootstrap(userDataDir, profileName, bootstrap.mode)
  })
  await runtime.persistBootstrap(profileName, bootstrap.mode)
  runtime.registerTrayItem({
    group: 'tools',
    order: 10,
    label: () => desktopTrayLabel(runtime.locale, 'openTerminal'),
    invoke: () => { runtime.openTerminal() },
  })
  runtime.registerTrayItem({
    group: 'status',
    order: 20,
    label: () => desktopTrayLabel(runtime.locale, 'exportDiagnostics'),
    invoke: () => { void runtime.exportDiagnostics() },
  })
  runtime.registerTrayItem({
    group: 'status',
    order: 30,
    label: () => desktopTrayLabel(runtime.locale, 'checkForUpdates'),
    invoke: () => {
      runtime.notifyAttention({
        title: PRODUCT_NAME,
        body: runtime.locale === 'zh' ? '正在检查更新…' : 'Checking for updates…',
      })
    },
  })
  if (devtoolsEnabled) {
    runtime.registerTrayItem({
      group: 'tools',
      order: 40,
      label: () => 'Developer Logs',
      invoke: () => { runtime.openDevtools({ tab: 'logs', origin: carrier.origin }) },
    })
    runtime.registerTrayItem({
      group: 'tools',
      order: 41,
      label: () => 'Developer Network',
      invoke: () => { runtime.openDevtools({ tab: 'network', origin: carrier.origin }) },
    })
  }

  return {
    url: carrier.url,
    profileName,
    runtime,
    stop: async () => {
      await release()
      await carrier.close()
      nodeRuntime?.dispose()
      runtime.dispose()
    },
  }
}

function parseArgv(argv: readonly string[]): { recovery: boolean } {
  return { recovery: argv.includes('--recovery') || argv.includes('--dsh-desktop-recovery') }
}

function platformOfProcess(): DesktopPlatform {
  return platformOf(process.platform)
}

async function main(): Promise<void> {
  await installBunHostCompat()
  const { recovery } = parseArgv(process.argv.slice(2))
  const transport = createStdioTransport()
  const userDataDir = process.env.DSH_DESKTOP_USER_DATA && process.env.DSH_DESKTOP_USER_DATA.length > 0
    ? process.env.DSH_DESKTOP_USER_DATA
    : defaultDesktopUserDataDirectory()
  const pluginRoot = dshPluginDesktopRoot()
  const tauriHost = officialHostEntry(pluginRoot)
  if (tauriHost === undefined && process.env.DSH_OFFICIAL_HOST !== '0' && process.env.DSH_OFFICIAL_HOST !== 'false' && process.env.DSH_OFFICIAL_HOST !== 'off') {
    throw new Error(`dsh-desktop: official Host launcher is missing at ${join(pluginRoot, 'lib/tauri-host.js')}`)
  }
  if (tauriHost !== undefined) {
    process.stderr.write(`dsh-desktop: starting official Host ${tauriHost}\n`)
    const runtime = new IpcDesktopRuntime(transport, {
      platform: platformOfProcess(),
      userDataDir,
      isPackaged: process.env.DSH_PACKAGED === '1',
      currentVersion: JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version as string,
    })
    const loaded = await import(pathToFileURL(tauriHost).href) as {
      startTauriHost: (options: {
        runtime: IpcDesktopRuntime
        userDataDir: string
        isPackaged: boolean
        locale: 'zh' | 'en'
        nodeExecutable: string
        pnpmBinPath: string
        nodeVersion: string
        productVersion: string
        recoveryRequested: boolean
        argv: readonly string[]
        installNodeRuntime: typeof installDesktopNodeRuntime
        relaunch: (args?: readonly string[]) => void
        exit: (code: number) => void
        openPath: (path: string) => Promise<string>
      }) => Promise<void>
    }
    await loaded.startTauriHost({
      runtime,
      userDataDir,
      isPackaged: process.env.DSH_PACKAGED === '1',
      locale: runtime.locale,
      nodeExecutable: process.execPath,
      pnpmBinPath: join(pluginRoot, 'node_modules/pnpm/bin/pnpm.mjs'),
      nodeVersion: process.versions.node,
      productVersion: JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).version as string,
      recoveryRequested: recovery,
      argv: process.argv,
      installNodeRuntime: installDesktopNodeRuntime,
      relaunch: args => {
        if (args?.includes('--dsh-desktop-recovery')) void runtime.requestRecoveryRestart()
        else void runtime.requestRestart()
      },
      exit: code => {
        runtime.prepareToQuit()
        process.exit(code)
      },
      openPath: async path => {
        const { spawn } = await import('node:child_process')
        spawn('open', [path], { stdio: 'ignore', detached: true }).unref()
        return ''
      },
    })
    return
  }
  const handle = await runHostMain({
    transport,
    recovery,
    userDataDir,
  })
  const shutdown = async (): Promise<void> => {
    await handle.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => { void shutdown() })
  process.on('SIGTERM', () => { void shutdown() })
}

const invoked = process.argv[1] !== undefined && (process.argv[1].endsWith('main.js') || process.argv[1].endsWith('main.ts'))
if (invoked) {
  void main().catch(cause => {
    process.stderr.write(`dsh-desktop: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}

