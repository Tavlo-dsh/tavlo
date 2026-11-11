export const HARNESS_REPOSITORY = 'https://github.com/deepseek-ai/deepseek-harness.git'
export const HARNESS_TRACK = 'latest-dsh-v-tag'
export const DSH_TAG_PREFIX = 'dsh-v'

/** Host still loads this published kernel until a git-only consumption path exists. */
export const LOADABLE_KERNEL_COMMIT = 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
export const LOADABLE_KERNEL_TAG = 'dsh-v0.1.1-rc.2'
export const LOADABLE_KERNEL_VERSION = '0.1.1-rc.2'

export type HarnessConsumption = 'npm' | 'packed-from-checkout'
export type HarnessTrack = typeof HARNESS_TRACK

export interface KernelPin {
  readonly repository: string
  readonly localPath: string
  readonly track: HarnessTrack
  readonly commit: string
  readonly tag: string
  readonly sourceVersion: string
  readonly runtimePackageVersion: string
  readonly npmPublished: boolean
  readonly consumption: HarnessConsumption
  readonly latestTag: string
  readonly latestTagCommit: string
  readonly commitsAhead: number
  readonly checkedAt: string
}

const DSH_TAG_NAME = /^dsh-v(.+)$/
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function peelGitRef(raw: string): string {
  let value = raw.trim()
  const refs = value.indexOf('refs/tags/')
  if (refs >= 0) value = value.slice(refs + 'refs/tags/'.length)
  if (value.endsWith('^{}')) value = value.slice(0, -3)
  return value
}

export function sourceVersionFromTag(tag: string): string {
  const peeled = peelGitRef(tag)
  const match = DSH_TAG_NAME.exec(peeled)
  if (match === null || match[1] === undefined) {
    throw new Error(`dsh-desktop: kernel tag must start with ${DSH_TAG_PREFIX}: ${tag}`)
  }
  return match[1]
}

export function selectLatestDshTag(tags: readonly string[]): string {
  const names = new Set<string>()
  for (const raw of tags) {
    const name = peelGitRef(raw)
    if (DSH_TAG_NAME.test(name)) names.add(name)
  }
  if (names.size === 0) {
    throw new Error('dsh-desktop: no dsh-v* tags in the candidate list')
  }
  let latest: string | undefined
  for (const name of names) {
    if (latest === undefined || compareDshTags(name, latest) > 0) latest = name
  }
  if (latest === undefined) {
    throw new Error('dsh-desktop: no dsh-v* tags in the candidate list')
  }
  return latest
}

export function parseKernelPin(value: unknown): KernelPin {
  if (value === null || typeof value !== 'object') {
    throw new Error('dsh-desktop: kernel pin must be an object')
  }
  const record = value as Record<string, unknown>
  const pin: KernelPin = {
    repository: requiredString(record, 'repository'),
    localPath: requiredString(record, 'localPath'),
    track: requiredTrack(record.track),
    commit: requiredString(record, 'commit'),
    tag: requiredString(record, 'tag'),
    sourceVersion: requiredString(record, 'sourceVersion'),
    runtimePackageVersion: requiredString(record, 'runtimePackageVersion'),
    npmPublished: requiredBoolean(record, 'npmPublished'),
    consumption: requiredConsumption(record.consumption),
    latestTag: requiredString(record, 'latestTag'),
    latestTagCommit: requiredString(record, 'latestTagCommit'),
    commitsAhead: requiredNonNegativeInteger(record, 'commitsAhead'),
    checkedAt: requiredString(record, 'checkedAt'),
  }
  assertPinInvariants(pin)
  return pin
}

export function assertPinInvariants(pin: KernelPin): void {
  if (pin.repository !== HARNESS_REPOSITORY) {
    throw new Error(`dsh-desktop: kernel pin repository must be ${HARNESS_REPOSITORY}`)
  }
  if (pin.track !== HARNESS_TRACK) {
    throw new Error(`dsh-desktop: kernel pin track must be ${HARNESS_TRACK}`)
  }
  if (pin.sourceVersion !== pin.runtimePackageVersion) {
    throw new Error('dsh-desktop: sourceVersion must equal runtimePackageVersion')
  }
  if (sourceVersionFromTag(pin.tag) !== pin.sourceVersion) {
    throw new Error('dsh-desktop: sourceVersion must be the tag without the dsh-v prefix')
  }
  sourceVersionFromTag(pin.latestTag)
  if (pin.consumption === 'npm' && !pin.npmPublished) {
    throw new Error('dsh-desktop: consumption "npm" requires npmPublished')
  }
}

export function assertLoadableProductPin(pin: KernelPin): void {
  assertPinInvariants(pin)
  if (
    pin.tag !== LOADABLE_KERNEL_TAG
    || pin.commit !== LOADABLE_KERNEL_COMMIT
    || pin.runtimePackageVersion !== LOADABLE_KERNEL_VERSION
  ) {
    throw new Error('dsh-desktop: loadable kernel pin must stay on 0.1.1-rc.2 until a consumption path exists')
  }
  if (pin.consumption !== 'npm' || !pin.npmPublished) {
    throw new Error('dsh-desktop: loadable kernel pin is consumed from npm')
  }
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`dsh-desktop: kernel pin.${key} must be a non-empty string`)
  }
  return value
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') {
    throw new Error(`dsh-desktop: kernel pin.${key} must be a boolean`)
  }
  return value
}

function requiredNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`dsh-desktop: kernel pin.${key} must be a non-negative integer`)
  }
  return value
}

function requiredTrack(value: unknown): HarnessTrack {
  if (value !== HARNESS_TRACK) {
    throw new Error(`dsh-desktop: kernel pin.track must be ${HARNESS_TRACK}`)
  }
  return value
}

function requiredConsumption(value: unknown): HarnessConsumption {
  if (value !== 'npm' && value !== 'packed-from-checkout') {
    throw new Error('dsh-desktop: kernel pin.consumption must be "npm" or "packed-from-checkout"')
  }
  return value
}

function compareDshTags(left: string, right: string): number {
  return compareSemver(sourceVersionFromTag(left), sourceVersionFromTag(right))
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease === undefined && b.prerelease === undefined) return 0
  if (a.prerelease === undefined) return 1
  if (b.prerelease === undefined) return -1
  return comparePrerelease(a.prerelease, b.prerelease)
}

function parseSemver(version: string): {
  major: number
  minor: number
  patch: number
  prerelease: string | undefined
} {
  const match = SEMVER.exec(version)
  if (match === null) {
    throw new Error(`dsh-desktop: not a semver version: ${version}`)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  }
}

function comparePrerelease(left: string, right: string): number {
  const a = left.split('.')
  const b = right.split('.')
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xn = numericIdent(x)
    const yn = numericIdent(y)
    if (xn !== undefined && yn !== undefined) {
      if (xn !== yn) return xn - yn
      continue
    }
    if (xn !== undefined) return -1
    if (yn !== undefined) return 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function numericIdent(value: string): number | undefined {
  if (value.length === 0 || !/^\d+$/.test(value)) return undefined
  return Number(value)
}
