/** Tauri Host process: same launcher as main.ts, with DesktopRuntime injected. */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  boot,
  installFailLoud,
  loadLayeredEnv,
  PROFILE_PATCH_FILENAME,
  resolveProfileDir,
  type FailLoudProcess,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { installDesktopDshRuntime } from './desktop-runtime-environment.ts'
import { createDesktopBrowserAccess } from './desktop-browser-access.ts'
import {
  ElectronStderrLogger,
  installDesktopUncaughtExceptionLogging,
} from './desktop-logger.ts'
import { beginDesktopRun } from './crash-evidence.ts'
import { createDesktopLifecycleRecorder } from './lifecycle-events.ts'
import type {
  DesktopLifecycleFailureReason,
  DesktopLifecycleRendererFailureReason,
} from './lifecycle-events.ts'
import { FileExporter } from './file-exporter.ts'
import { DESKTOP_SETTINGS_NAMESPACE, type DesktopSettings } from './index.ts'
import { LogFileSink } from './log-files.ts'
import { maskSecrets } from './mask-secrets.ts'
import { resolveDesktopShellEnvironment } from './shell-environment.ts'
import { installProfilePackageResolver } from './module-resolution.ts'
import {
  beginDesktopProfileStartup,
  assertDesktopProfileName,
  createDesktopWebProfile,
  listDesktopProfiles,
  canDeleteDesktopProfile,
  deleteDesktopProfile,
  readDesktopProfileState,
  selectDesktopProfile,
} from './profile-manager.ts'
import { DesktopProfileService } from './profile-service.ts'
import { DesktopActionsService } from './desktop-actions.ts'
import { clearDesktopProfilePluginState, DesktopPluginsService } from './desktop-plugins.ts'
import {
  desktopMarketSnapshotWithEffective,
  readDesktopMarketStateForUserData,
  selectDesktopMarketProvider,
} from './desktop-market.ts'
import DesktopSettingsController from './desktop-settings-controller.ts'
import { DesktopStartupRecoveryController } from './startup-recovery-controller.ts'
import type {
  DesktopStartupRecoveryConfigurationPaths,
  DesktopStartupRecoveryProfileActions,
  DesktopStartupFailureStage,
} from './startup-recovery-window.ts'
import { routeDesktopStartupFailure } from './startup-failure-routing.ts'
import { DesktopStartupGeneration } from './startup-generation.ts'
import { desktopInstallAnchor, prepareDesktopProfile } from './profile.ts'
import { migrateDesktopBrowserAccessSettings, migrateDesktopWindowMaterialSettings } from './setup-wizard-settings.ts'
import { clearDesktopProfileCheckpoint, DesktopProfileCheckpoint } from './profile-checkpoint.ts'
import { materializeProfile, ProfileMaterializationError } from './profile-materializer.ts'
import type { DesktopPnpmBootstrap } from './pnpm.ts'
import {
  createDesktopExitCoordinator,
  createDesktopShutdown,
} from './shutdown.ts'
import {
  diagnoseWindowsVolumes,
  formatWindowsVolumeConcern,
} from './windows-volume-diagnostics.ts'
import { desktopNativeCopy } from './native-dialog-copy.ts'
import { desktopRecoveryRelaunchArguments } from './relaunch-arguments.ts'
import type { DesktopRuntime, DesktopNotification, DesktopTerminalSpec } from './runtime.ts'
import type { RendererHealthFailureReason, RendererHealthVerdict } from './renderer-health.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const PRODUCT_NAME = 'DSH Desktop'

class RendererStartupFailure extends Error {
  constructor(
    readonly reason: 'renderer-failed' | 'renderer-timeout',
    report: { status: 'failed', plugins: readonly string[], error?: string },
  ) {
    super(report.error ?? `Renderer boot failed for ${String(report.plugins.length)} plugin(s)`)
    this.name = 'RendererStartupFailure'
  }
}

export interface TauriHostRuntime extends DesktopRuntime {
  configureTerminal(spec: DesktopTerminalSpec): void
  setTerminalRuntime?(runtime: {
    nodeExecutable: string
    dshBootstrapPath: string
    pnpmBinPath: string
    nodeVersion: string
    productVersion: string
  }): void
  beginRendererBootMonitoring(
    options: { commitHealthy: () => Promise<void> },
    timeoutMs?: number,
  ): Promise<RendererHealthVerdict>
  stopRendererBootMonitoring(): void
  readonly rendererBootFailureReason: RendererHealthFailureReason | undefined
}

export interface TauriHostNodeRuntime {
  readonly pathDir: string
  readonly pnpmShimPath: string
  readonly nodeBinDir: string
  readonly nodeShimPath: string
  readonly clearEnvironmentPath: string
  dispose(): void
}

export interface TauriHostOptions {
  readonly runtime: TauriHostRuntime
  readonly userDataDir: string
  readonly isPackaged: boolean
  readonly locale: 'zh' | 'en'
  readonly nodeExecutable: string
  readonly pnpmBinPath: string
  readonly nodeVersion: string
  readonly productVersion: string
  readonly recoveryRequested: boolean
  readonly argv: readonly string[]
  installNodeRuntime(input: {
    platform: NodeJS.Platform
    nodeExecutable: string
    pnpmBinPath: string
    nodeVersion: string
    stateDir: string
    environment: NodeJS.ProcessEnv
  }): TauriHostNodeRuntime
  relaunch(args?: readonly string[]): void
  exit(code: number): void
  openPath(path: string): Promise<string>
}

function lifecycleRendererFailureReason(
  reason: RendererHealthFailureReason | undefined,
): DesktopLifecycleRendererFailureReason {
  return reason === 'renderer-timeout' ? 'renderer-timeout' : 'renderer-failed'
}

function lifecycleStartupFailureReason(
  cause: unknown,
  runtime: TauriHostRuntime,
): DesktopLifecycleFailureReason {
  if (cause instanceof RendererStartupFailure) return cause.reason
  return runtime.rendererBootFailureReason ?? 'startup-failed'
}

function notifySkippedOptionalEntries(
  runtime: TauriHostRuntime,
  logger: ElectronStderrLogger,
  names: readonly string[],
): void {
  if (names.length === 0) return
  const copy = desktopNativeCopy(runtime.locale)
  try {
    runtime.updates.notify({
      title: copy.skippedPluginTitle,
      body: copy.skippedPluginBody(names[0]!, names.length - 1),
    })
  } catch (cause) {
    logger.error(`${BIN_NAME}: failed to show skipped plugin notification: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export async function startTauriHost(options: TauriHostOptions): Promise<void> {
  const runtime = options.runtime
  let shutdown: ReturnType<typeof createDesktopShutdown> | undefined
  let fileExporter: FileExporter | undefined
  let logSink: LogFileSink | undefined
  let startupRecoveryController: DesktopStartupRecoveryController | undefined
  let startupRecoveryConfigurationPaths: DesktopStartupRecoveryConfigurationPaths | undefined
  let profileCheckpoint: DesktopProfileCheckpoint | undefined
  let startupRecoveryProfileActions: DesktopStartupRecoveryProfileActions | undefined
  let profileRecoveryActionUsed = false
  let recoveryTerminalAvailable = false
  let startupStage: DesktopStartupFailureStage = 'electron-ready'
  const appVersion = options.productVersion
  try {
    logSink = new LogFileSink(join(options.userDataDir, 'logs'), {
      maxFileBytes: 10 * 1024 * 1024,
      maxDirectoryBytes: 200 * 1024 * 1024,
    })
    logSink.enforceDirectoryCap()
    logSink.purgeOlderThan(7)
    logSink.writeHeader(`--- ${BIN_NAME} ${PRODUCT_NAME} ${appVersion} ${process.platform} node ${process.version} run ${Date.now()} ---`)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    process.stderr.write(`${BIN_NAME}: file logging unavailable: ${maskSecrets(detail)}\n`)
    logSink = undefined
  }
  const electronLogger = new ElectronStderrLogger(logSink)
  const generation = new DesktopStartupGeneration({ logger: electronLogger })
  const generationId = generation.id
  const lifecycleRecorder = createDesktopLifecycleRecorder({
    userDataDir: options.userDataDir,
    appVersion,
    platform: process.platform,
    arch: process.arch,
    logger: electronLogger,
  })
  lifecycleRecorder.startStartup(startupStage)
  let desktopRun: ReturnType<typeof beginDesktopRun> | undefined
  try {
    desktopRun = beginDesktopRun(
      join(options.userDataDir, 'crash-evidence', 'active-run.json'),
      {
        startedAt: new Date().toISOString(),
        pid: process.pid,
        version: appVersion,
      },
    )
    const previousRun = desktopRun.previousRun
    if (previousRun !== undefined) {
      electronLogger.error('unreadable' in previousRun
        ? `${BIN_NAME}: previous desktop run did not shut down cleanly (active run marker unreadable)`
        : `${BIN_NAME}: previous desktop run did not shut down cleanly (startedAt: ${previousRun.startedAt}, pid: ${String(previousRun.pid)}, version: ${previousRun.version})`)
    }
  } catch (cause) {
    electronLogger.error(`${BIN_NAME}: active run tracking unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const nativeExit = createDesktopExitCoordinator(
    {
      prepareToQuit: () => { runtime.prepareToQuit() },
      relaunch: args => { options.relaunch(args) },
      exit: code => { options.exit(code) },
    },
    () => {
      try {
        desktopRun?.markClean()
      } catch (cause) {
        electronLogger.error(`${BIN_NAME}: failed to clear active run marker: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    },
  )
  const finalExit = (code: number): void => { nativeExit.finish(code) }
  shutdown = createDesktopShutdown(
    async () => { await generation.release() },
    finalExit,
  )
  const requestQuit = (code: number): void => { void shutdown!.request(code) }
  installDesktopUncaughtExceptionLogging(process, electronLogger, requestQuit)

  const openStartupRecoveryWindow = async (
    failureDetail: string,
    controller: DesktopStartupRecoveryController | undefined,
    requested = false,
  ): Promise<'restart' | 'quit' | 'unavailable'> => {
    try {
      await runtime.openRecovery({
        locale: runtime.locale,
        failureStage: startupStage,
        failureDetail: maskSecrets(failureDetail),
        requested,
        ...(controller === undefined ? {} : { hasController: true }),
        ...(startupRecoveryConfigurationPaths === undefined ? {} : { configurationPaths: startupRecoveryConfigurationPaths }),
        ...(recoveryTerminalAvailable ? { terminalAvailable: true } : {}),
        ...(startupRecoveryProfileActions === undefined ? {} : { profiles: startupRecoveryProfileActions.list() }),
      })
      return 'quit'
    } catch (cause) {
      electronLogger.error(
        `${BIN_NAME}: failed to open startup recovery window: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
      return 'unavailable'
    }
  }

  try {
    startupStage = 'shell-environment'
    lifecycleRecorder.transitionStartupStage(startupStage)
    if (options.isPackaged && process.cwd() === '/') process.chdir(homedir())
    const shellEnvironmentResolution = await resolveDesktopShellEnvironment({
      environment: process.env,
      home: homedir(),
      isPackaged: options.isPackaged,
      platform: process.platform,
    })
    for (const [name, value] of Object.entries(shellEnvironmentResolution.updates)) process.env[name] = value
    const homeDir = resolveDshHome()
    const windowsVolumeConcerns = diagnoseWindowsVolumes(process.platform, [
      { label: 'application install', path: options.nodeExecutable },
      { label: 'desktop user data', path: options.userDataDir },
      { label: 'DSH home', path: homeDir },
    ])
    for (const concern of windowsVolumeConcerns) {
      electronLogger.error(`${BIN_NAME}: Windows volume warning: ${formatWindowsVolumeConcern(concern)}`)
    }

    const failLoudProcess: FailLoudProcess = {
      on: (event, handler) => process.on(event, handler),
      off: (event, handler) => process.off(event, handler),
      stderr: electronLogger,
      exit: finalExit,
    }
    installFailLoud(BIN_NAME, failLoudProcess, async () => { await generation.release() })

    startupStage = 'runtime-bootstrap'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const environment = loadLayeredEnv(BIN_NAME, process.cwd())
    const pnpmBinPath = options.pnpmBinPath
    const pnpmRuntime = options.installNodeRuntime({
      platform: process.platform,
      nodeExecutable: options.nodeExecutable,
      pnpmBinPath,
      nodeVersion: options.nodeVersion,
      stateDir: join(options.userDataDir, 'runtime-commands'),
      environment: process.env,
    })
    const releasePnpmRuntime = generation.own(() => { pnpmRuntime.dispose() })
    const selectionStatePath = join(options.userDataDir, 'profile-selection', 'state.json')
    const pluginManagementStatePath = join(options.userDataDir, 'plugin-management', 'state.json')
    const startupRecoveryStatePath = join(options.userDataDir, 'startup-recovery', 'state.json')
    startupStage = 'profile-selection'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const profileStartup = beginDesktopProfileStartup(selectionStatePath, homeDir)
    const activeProfileName = profileStartup.profileName
    const activeProfileDir = resolveProfileDir(activeProfileName, homeDir)
    const recoveryProfileToken = randomUUID()
    startupRecoveryProfileActions = {
      token: recoveryProfileToken,
      list: () => listDesktopProfiles(homeDir).map(profile => ({
        name: profile.name,
        current: profile.name === activeProfileName,
        selectable: profile.webCapable && profile.problem === undefined,
      })),
      switchProfile: (name, token) => {
        if (token !== recoveryProfileToken || profileRecoveryActionUsed) {
          throw new Error(`${BIN_NAME}: the Profile recovery action is no longer valid`)
        }
        profileRecoveryActionUsed = true
        assertDesktopProfileName(name)
        const selection = readDesktopProfileState(selectionStatePath)
        if (selection.active !== activeProfileName) throw new Error(`${BIN_NAME}: active Profile changed before recovery`)
        const target = listDesktopProfiles(homeDir).find(profile => profile.name === name)
        if (target === undefined || !target.webCapable || target.problem !== undefined) {
          throw new Error(`${BIN_NAME}: Profile ${JSON.stringify(name)} is unavailable`)
        }
        selectDesktopProfile(selectionStatePath, homeDir, name)
      },
      openCreator: () => {
        runtime.openProfileCreateWindow({
          onSubmit: async name => {
            assertDesktopProfileName(name)
            const selection = readDesktopProfileState(selectionStatePath)
            if (selection.active !== activeProfileName) throw new Error(`${BIN_NAME}: active Profile changed before recovery`)
            createDesktopWebProfile(homeDir, name)
            selectDesktopProfile(selectionStatePath, homeDir, name)
          },
        })
      },
    }
    try {
      profileCheckpoint = new DesktopProfileCheckpoint({
        userDataDir: options.userDataDir,
        profileDir: activeProfileDir,
        profileName: activeProfileName,
        provider: 'desktop-profile',
        appVersion,
      })
    } catch (cause) {
      electronLogger.error(
        `${BIN_NAME}: healthy profile checkpoints are unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    startupRecoveryConfigurationPaths = {
      settingsDocument: join(homeDir, 'settings.yaml'),
      profilePatch: join(activeProfileDir, PROFILE_PATCH_FILENAME),
      profileManifest: join(activeProfileDir, 'package.json'),
      profileDirectory: activeProfileDir,
    }
    if (profileCheckpoint !== undefined) {
      startupRecoveryController = new DesktopStartupRecoveryController({
        pluginState: {
          profileName: activeProfileName,
          homeDir,
          statePath: startupRecoveryStatePath,
        },
        generationId,
        currentGeneration: () => ({
          profileName: readDesktopProfileState(selectionStatePath).active,
          generationId,
        }),
        checkpoints: profileCheckpoint,
        openCheckpointDirectory: async path => {
          const error = await options.openPath(path)
          if (error.length > 0) throw new Error(error)
        },
        afterCheckpointRestore: async result => {
          if (!result.changedFiles.some(name => name === 'package.json'
            || name === 'pnpm-lock.yaml' || name === 'pnpm-workspace.yaml')) return
          await materializeProfile({
            appExecutable: options.nodeExecutable,
            clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
            pnpmBinPath,
            nodeBinDir: pnpmRuntime.nodeBinDir,
            nodeShimPath: pnpmRuntime.nodeShimPath,
            homeDir,
            profileDir: activeProfileDir,
            electronVersion: options.nodeVersion,
          })
        },
      })
    }
    if (options.recoveryRequested) {
      const recoveryResult = await openStartupRecoveryWindow(
        'Recovery mode was requested from the Desktop restart menu.',
        startupRecoveryController,
        true,
      )
      startupRecoveryController?.dispose()
      startupRecoveryController = undefined
      if (recoveryResult === 'restart') nativeExit.requestRelaunch(desktopRecoveryRelaunchArguments(options.argv))
      await shutdown.request(recoveryResult === 'restart' ? 0 : 1)
      return
    }
    startupStage = 'profile-composition'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const marketUserDataDir = options.userDataDir
    const marketSelection = readDesktopMarketStateForUserData(marketUserDataDir)
    const preparationHooks = {
      onSettingsDocumentResolved: (settingsDocument: string) => {
        if (startupRecoveryConfigurationPaths === undefined) return
        startupRecoveryConfigurationPaths = {
          ...startupRecoveryConfigurationPaths,
          settingsDocument,
        }
      },
    }
    let prepared = prepareDesktopProfile(
      process.env.DSH_TELEMETRY_DISABLED,
      homeDir,
      process.platform,
      activeProfileName,
      pluginManagementStatePath,
      marketSelection,
      preparationHooks,
    )
    const browserAccessMigrated = await migrateDesktopBrowserAccessSettings(prepared.settingsDocument)
    let windowMaterialMigrated = false
    try {
      windowMaterialMigrated = await migrateDesktopWindowMaterialSettings(prepared.settingsDocument)
    } catch (cause) {
      electronLogger.error(
        `${BIN_NAME}: failed to persist removed Acrylic material migration: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    }
    if (browserAccessMigrated || windowMaterialMigrated) {
      prepared = prepareDesktopProfile(
        process.env.DSH_TELEMETRY_DISABLED,
        homeDir,
        process.platform,
        activeProfileName,
        pluginManagementStatePath,
        marketSelection,
        preparationHooks,
      )
    }
    if (profileCheckpoint === undefined) {
      try {
        profileCheckpoint = new DesktopProfileCheckpoint({
          userDataDir: options.userDataDir,
          profileDir: prepared.profile.dir,
          profileName: activeProfileName,
          provider: 'desktop-profile',
          appVersion,
        })
      } catch (cause) {
        electronLogger.error(
          `${BIN_NAME}: healthy profile checkpoints remain unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    }
    startupStage = 'runtime-bootstrap'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const dshBootstrapPath = fileURLToPath(new URL('./desktop-cli.js', import.meta.url))
    options.runtime.setTerminalRuntime?.({
      nodeExecutable: options.nodeExecutable,
      dshBootstrapPath,
      pnpmBinPath: options.pnpmBinPath,
      nodeVersion: options.nodeVersion,
      productVersion: options.productVersion,
    })
    const dshRuntime = process.platform === 'win32'
      ? installDesktopDshRuntime({
          platform: process.platform,
          appExecutable: options.nodeExecutable,
          dshBootstrapPath,
          profileName: activeProfileName,
          homeDir,
          stateDir: join(options.userDataDir, 'host-commands', activeProfileName),
          environment: process.env,
        })
      : undefined
    const releaseDshRuntime = generation.own(() => { dshRuntime?.dispose() })
    if (prepared.requiresDependencyMigration) {
      electronLogger.error(`${BIN_NAME}: migrating legacy Profile dependency layout with packaged pnpm`)
      try {
        await materializeProfile({
          appExecutable: options.nodeExecutable,
          clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
          pnpmBinPath,
          nodeBinDir: pnpmRuntime.nodeBinDir,
          nodeShimPath: pnpmRuntime.nodeShimPath,
          homeDir,
          profileDir: prepared.profile.dir,
          electronVersion: options.nodeVersion,
          updateLockfile: true,
        })
        prepared = prepareDesktopProfile(
          process.env.DSH_TELEMETRY_DISABLED,
          homeDir,
          process.platform,
          activeProfileName,
          pluginManagementStatePath,
          marketSelection,
          preparationHooks,
        )
        if (prepared.requiresDependencyMigration) {
          throw new Error(`${BIN_NAME}: packaged pnpm did not produce compatible Profile dependency metadata`)
        }
      } catch (migrationCause) {
        const detail = migrationCause instanceof ProfileMaterializationError
          ? migrationCause.result?.stderr || migrationCause.message
          : migrationCause instanceof Error ? migrationCause.message : String(migrationCause)
        throw new Error(`${BIN_NAME}: Profile dependency migration failed: ${maskSecrets(detail)}`)
      }
    }
    if (prepared.marketFailure !== undefined) {
      electronLogger.error(
        `${BIN_NAME}: requested Market provider ${prepared.market.requested} was disabled for this generation: ${prepared.marketFailure}`,
      )
    }
    const browserAccess = createDesktopBrowserAccess(
      prepared.mode === 'compatibility' && prepared.openBrowser,
    )
    const desktopPnpmBootstrap: DesktopPnpmBootstrap = {
      activeProfileName,
      activeProfileDir: prepared.profile.dir,
      homeDir,
      appExecutable: options.nodeExecutable,
      pnpmBinPath,
      electronVersion: options.nodeVersion,
      nodeBinDir: pnpmRuntime.nodeBinDir,
      nodeShimPath: pnpmRuntime.nodeShimPath,
      clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
      dshBootstrapPath,
    }
    startupStage = 'host-boot'
    lifecycleRecorder.transitionStartupStage(startupStage)
    const releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
    runtime.configureTerminal({
      profileName: activeProfileName,
      profileDir: prepared.profile.dir,
      homeDir,
    })
    recoveryTerminalAvailable = true
    const ctx = await boot(
      BIN_NAME,
      prepared.rootConfig,
      prepared.patches,
      async (hostCtx) => {
        generation.bindHost(hostCtx)
        hostCtx.effect(
          () => releasePnpmRuntime,
          'dsh-plugin-desktop: packaged pnpm runtime PATH',
        )
        if (dshRuntime !== undefined) {
          hostCtx.effect(
            () => releaseDshRuntime,
            'dsh-plugin-desktop: packaged dsh runtime PATH',
          )
        }
        hostCtx.effect(
          () => releasePackageResolver,
          'dsh-plugin-desktop: profile package resolution',
        )
        hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment)
        hostCtx.provide('desktopBrowserAccess', browserAccess)
        hostCtx.provide('desktopRuntime', runtime)
        hostCtx.provide('desktopPnpmBootstrap', desktopPnpmBootstrap)
        await hostCtx.plugin(DesktopActionsService, {
          openTerminal: () => { runtime.openTerminal() },
          requestRestart: () => runtime.requestRestart(),
        })
        if (prepared.market.effective === 'community-market') {
          await hostCtx.plugin(DesktopPluginsService, {
            profileName: activeProfileName,
            homeDir,
            statePath: pluginManagementStatePath,
            recoveryStatePath: startupRecoveryStatePath,
            installAnchor: desktopInstallAnchor(),
          })
        }
        if (logSink !== undefined) {
          fileExporter = new FileExporter(logSink)
          hostCtx.logger.exporter(fileExporter)
        }
        await hostCtx.plugin(DesktopProfileService, {
          current: {
            name: activeProfileName,
            dir: prepared.profile.dir,
          },
          create: name => createDesktopWebProfile(homeDir, name),
          list: () => listDesktopProfiles(homeDir),
          canDelete: name => canDeleteDesktopProfile({
            home: homeDir,
            selectionStatePath,
            currentProfileName: activeProfileName,
          }, name),
          delete: name => deleteDesktopProfile({
            home: homeDir,
            selectionStatePath,
            currentProfileName: activeProfileName,
            clearDisabledState: () => clearDesktopProfilePluginState(pluginManagementStatePath, name),
            clearCheckpoint: () => clearDesktopProfileCheckpoint(options.userDataDir, resolveProfileDir(name, homeDir)),
          }, name),
          persistSelection: name => { selectDesktopProfile(selectionStatePath, homeDir, name) },
          requestRestart: () => runtime.requestRestart(),
        })
        let pendingSettingsRestart: ReturnType<typeof setImmediate> | undefined
        const scheduleSettingsRestart = (): void => {
          pendingSettingsRestart ??= setImmediate(() => {
            pendingSettingsRestart = undefined
            void runtime.requestRestart().catch((cause: unknown) => {
              hostCtx.logger.error(
                `${BIN_NAME}: failed to restart after Desktop setting change: ${cause instanceof Error ? cause.message : String(cause)}`,
              )
            })
          })
        }
        hostCtx.effect(() => () => {
          if (pendingSettingsRestart !== undefined) clearImmediate(pendingSettingsRestart)
          pendingSettingsRestart = undefined
        }, 'dsh-plugin-desktop: pending Desktop settings restart')
        const readMarket = () => desktopMarketSnapshotWithEffective(
          readDesktopMarketStateForUserData(marketUserDataDir),
          prepared.market.effective,
        )
        hostCtx.provide('desktopSettingsController', new DesktopSettingsController({
          profiles: hostCtx.desktopProfiles,
          persistProfileSelection: name => {
            selectDesktopProfile(selectionStatePath, homeDir, name)
          },
          readMarket,
          selectMarket: async provider => desktopMarketSnapshotWithEffective(
            await selectDesktopMarketProvider(marketUserDataDir, provider),
            prepared.market.effective,
          ),
          scheduleRestart: scheduleSettingsRestart,
          scheduleRecoveryRestart: () => {
            void runtime.requestRecoveryRestart().catch((cause: unknown) => {
              hostCtx.logger.error(
                `${BIN_NAME}: failed to restart in recovery mode: ${cause instanceof Error ? cause.message : String(cause)}`,
              )
            })
          },
          openTerminal: () => { runtime.openTerminal() },
          reloadRenderer: () => { runtime.reloadRenderer() },
          toggleDeveloperTools: () => { runtime.toggleDeveloperTools() },
          exportDiagnostics: () => runtime.exportDiagnostics(),
          openProfileCreator: () => {
            runtime.openProfileCreateWindow({
              onSubmit: async name => {
                hostCtx.desktopProfiles.create(name)
                await hostCtx.desktopProfiles.select(name)
              },
            })
          },
        }))
        provideCmdline(hostCtx, {
          args: ['--host', '127.0.0.1', '--port', String(prepared.port)],
          exit: requestQuit,
        })
      },
      prepared.bareModuleBaseUrl,
    ).catch((cause: unknown) => {
      releasePackageResolver()
      throw cause
    })
    generation.bindHost(ctx)
    fileExporter?.setThreshold((ctx.settings.get(DESKTOP_SETTINGS_NAMESPACE) as DesktopSettings | undefined)?.logLevel ?? 'info')
    ctx.on('settings/updated', (namespace, next) => {
      if (namespace !== DESKTOP_SETTINGS_NAMESPACE) return
      fileExporter?.setThreshold((next as DesktopSettings).logLevel)
    })
    startupStage = 'renderer-startup'
    lifecycleRecorder.transitionStartupStage(startupStage)
    lifecycleRecorder.startRendererBoot()
    const rendererBoot = runtime.beginRendererBootMonitoring({
      commitHealthy: async () => {
        lifecycleRecorder.finishRendererBoot({ status: 'healthy' }, 'renderer-failed')
        startupStage = 'health-commit'
        lifecycleRecorder.transitionStartupStage(startupStage)
        try {
          profileCheckpoint?.captureHealthy()
        } catch (cause) {
          electronLogger.error(
            `${BIN_NAME}: failed to checkpoint the healthy profile configuration: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        }
      },
    })
    const [, rendererVerdict] = await Promise.all([
      runtime.mountScheduled(),
      rendererBoot,
    ])
    const rendererReport = rendererVerdict.report
    if ('failureReason' in rendererVerdict) {
      throw new RendererStartupFailure(
        rendererVerdict.failureReason,
        rendererVerdict.report,
      )
    }
    lifecycleRecorder.completeStartup(startupStage, rendererReport)
    notifySkippedOptionalEntries(
      runtime,
      electronLogger,
      prepared.skippedOptionalEntries.map(entry => entry.name),
    )
    if (windowsVolumeConcerns.length > 0) {
      const copy = desktopNativeCopy(runtime.locale)
      const notification: DesktopNotification = {
        title: copy.unsupportedStorageTitle,
        body: copy.unsupportedStorageBody(windowsVolumeConcerns[0]?.label ?? 'A configured path'),
      }
      runtime.updates.notify(notification)
    }
  } catch (cause) {
    runtime.stopRendererBootMonitoring()
    lifecycleRecorder.failRendererBootIfPending(lifecycleRendererFailureReason(runtime.rendererBootFailureReason))
    lifecycleRecorder.failStartup(startupStage, lifecycleStartupFailureReason(cause, runtime))
    electronLogger.errorCause(cause)
    let exitCode = 1
    const failureRoute = routeDesktopStartupFailure({
      appReady: true,
      stage: startupStage,
    })
    const recoveryActionsSafe = await generation.quiesceForRecovery()
    if (failureRoute === 'startup-recovery') {
      const detail = cause instanceof Error ? cause.message : String(cause)
      const recoveryResult = await openStartupRecoveryWindow(
        detail,
        recoveryActionsSafe ? startupRecoveryController : undefined,
      )
      if (recoveryResult === 'restart') {
        nativeExit.requestRelaunch(desktopRecoveryRelaunchArguments(options.argv))
        exitCode = 0
      }
    }
    startupRecoveryController?.dispose()
    await shutdown.request(exitCode)
  }
}
