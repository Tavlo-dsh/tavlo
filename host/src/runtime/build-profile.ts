/** Compile-time and runtime switch for developer tools (logs + network inspector). */

import { COMPILED_DEV_TOOLS } from './build-profile.generated.ts'

export function resolveCompiledDevTools(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.DSH_DEV_TOOLS
  if (explicit === '0' || explicit === 'false' || explicit === 'off') return false
  if (explicit === '1' || explicit === 'true' || explicit === 'on') return true
  const profile = env.DSH_PROFILE
  if (profile === 'production' || profile === 'release' || profile === 'prod') return false
  if (env.GITHUB_ACTIONS === 'true') return false
  return true
}

export function isDevToolsEnabled(
  env: NodeJS.ProcessEnv = process.env,
  compiled: boolean = COMPILED_DEV_TOOLS,
): boolean {
  const explicit = env.DSH_DEV_TOOLS
  if (explicit === '0' || explicit === 'false' || explicit === 'off') return false
  if (explicit === '1' || explicit === 'true' || explicit === 'on') return true
  return compiled
}

export function devtoolsDir(userDataDir: string): string {
  return `${userDataDir.replace(/[\\/]$/u, '')}/devtools`
}
