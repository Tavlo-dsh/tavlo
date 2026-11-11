import {
  chmodSync,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const BIN_NAME = 'dsh-desktop'
const DEFAULT_PROFILE_NAME = 'desktop'
const STATE_VERSION = 2
const MAX_STATE_BYTES = 4 * 1024
const STATE_DIRECTORY_MODE = 0o700
const STATE_FILE_MODE = 0o600
const MAX_PROFILE_NAME_BYTES = 255

export interface DesktopProfileStateV2 {
  readonly version: 2
  readonly active: string
}

export interface LoadedDesktopProfileState {
  readonly state: DesktopProfileStateV2
  readonly recovered: boolean
}

class InvalidDesktopProfileStateError extends Error {}

export function defaultProfileState(): DesktopProfileStateV2 {
  return { version: STATE_VERSION, active: DEFAULT_PROFILE_NAME }
}

export function assertDesktopProfileName(name: string): void {
  if (typeof name !== 'string' || name.length === 0
    || name.includes('/') || name.includes('\\') || name === '.' || name === '..'
    || name === 'node_modules' || Buffer.byteLength(name, 'utf8') > MAX_PROFILE_NAME_BYTES
    || /[\0-\x1f\x7f-\x9f]/u.test(name)
    || /[<>:"|?*]/u.test(name) || /[. ]$/u.test(name)
    || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(name)) {
    throw new Error(`${BIN_NAME}: invalid desktop profile name ${JSON.stringify(name)}`)
  }
}

export function parseProfileState(text: string): DesktopProfileStateV2 {
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('selection state must be a JSON object')
  }
  const state = value as Record<string, unknown>
  if (state.version !== STATE_VERSION) throw new Error(`selection state version must be ${STATE_VERSION}`)
  if (typeof state.active !== 'string') throw new Error('selection state active profile must be a string')
  assertDesktopProfileName(state.active)
  return { version: STATE_VERSION, active: state.active }
}

export function loadProfileState(statePath: string): LoadedDesktopProfileState {
  let text: string
  try {
    if (lstatSync(statePath).isSymbolicLink()) {
      return { state: defaultProfileState(), recovered: true }
    }
    const descriptor = openSync(statePath, 'r')
    try {
      const size = fstatSync(descriptor).size
      if (size > MAX_STATE_BYTES) {
        throw new InvalidDesktopProfileStateError(`selection state exceeds ${MAX_STATE_BYTES} bytes`)
      }
      text = readFileSync(descriptor, 'utf8')
    } finally {
      closeSync(descriptor)
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: defaultProfileState(), recovered: false }
    }
    if (cause instanceof InvalidDesktopProfileStateError) {
      return { state: defaultProfileState(), recovered: true }
    }
    throw cause
  }
  try {
    return { state: parseProfileState(text), recovered: false }
  } catch {
    return { state: defaultProfileState(), recovered: true }
  }
}

export function writeProfileState(statePath: string, state: DesktopProfileStateV2): void {
  assertDesktopProfileName(state.active)
  const stateDir = dirname(statePath)
  mkdirSync(stateDir, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const directoryStat = lstatSync(stateDir)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`${BIN_NAME}: profile selection state directory is not private: ${stateDir}`)
  }
  chmodSync(stateDir, STATE_DIRECTORY_MODE)
  const temporary = join(stateDir, `.${basename(statePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(state, undefined, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: STATE_FILE_MODE,
    })
    chmodSync(temporary, STATE_FILE_MODE)
    renameSync(temporary, statePath)
  } finally {
    try {
      unlinkSync(temporary)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
  }
}

export function profileSelectionStatePath(userDataDir: string): string {
  return join(userDataDir, 'profile-selection', 'state.json')
}
