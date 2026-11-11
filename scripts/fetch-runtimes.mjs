import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultLockPath = join(repoRoot, 'scripts/runtimes.lock.json')
const defaultVendorDir = join(repoRoot, 'vendor/runtimes')

export function runtimePlatformKey(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64'
  if (platform === 'darwin' && (arch === 'x64' || arch === 'x86_64')) return 'darwin-x64'
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64'
  if (platform === 'linux' && arch === 'x64') return 'linux-x64'
  if (platform === 'win32' && arch === 'x64') return 'win32-x64'
  throw new Error(`dsh-desktop: no bundled JS runtime for ${platform}/${arch}`)
}

export function runtimeLayout(vendorDir = defaultVendorDir, windows = process.platform === 'win32') {
  return {
    vendorDir,
    bun: join(vendorDir, windows ? 'bun.exe' : 'bun'),
    node: join(vendorDir, windows ? 'node.exe' : 'node'),
    stamp: join(vendorDir, 'stamp.json'),
    cacheDir: join(dirname(vendorDir), 'runtimes-cache'),
  }
}

export function loadRuntimeLock(lockPath = defaultLockPath) {
  return JSON.parse(readFileSync(lockPath, 'utf8'))
}

export function stampFor(lock, platformKey) {
  return {
    bun: lock.bun.version,
    node: lock.node.version,
    platform: platformKey,
  }
}

export function stampMatches(existing, expected) {
  return existing !== null
    && existing !== undefined
    && existing.bun === expected.bun
    && existing.node === expected.node
    && existing.platform === expected.platform
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function readStamp(path) {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function archiveKind(url) {
  if (url.endsWith('.zip')) return 'zip'
  if (url.endsWith('.tar.gz') || url.endsWith('.tgz')) return 'tar.gz'
  throw new Error(`dsh-desktop: unsupported runtime archive ${url}`)
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`dsh-desktop: download failed ${response.status} ${url}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

function extractMember(archivePath, kind, member, destFile) {
  const scratch = mkdtempSync(join(tmpdir(), 'dsh-runtime-extract-'))
  try {
    if (kind === 'zip') {
      const unzip = spawnSync('unzip', ['-o', '-j', archivePath, member, '-d', scratch], { encoding: 'utf8' })
      if (unzip.status !== 0) {
        throw new Error(`dsh-desktop: unzip failed: ${unzip.stderr || unzip.stdout}`)
      }
    } else {
      const tar = spawnSync('tar', ['-xzf', archivePath, '-C', scratch, member], { encoding: 'utf8' })
      if (tar.status !== 0) {
        throw new Error(`dsh-desktop: tar failed: ${tar.stderr || tar.stdout}`)
      }
    }
    const extracted = kind === 'zip' ? join(scratch, member.split('/').pop() ?? member) : join(scratch, member)
    if (!existsSync(extracted)) {
      throw new Error(`dsh-desktop: archive member missing after extract: ${member}`)
    }
    mkdirSync(dirname(destFile), { recursive: true })
    rmSync(destFile, { force: true })
    try {
      renameSync(extracted, destFile)
    } catch {
      copyFileSync(extracted, destFile)
      unlinkSync(extracted)
    }
    if (process.platform !== 'win32') chmodSync(destFile, 0o755)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

export async function fetchRuntimes(options = {}) {
  const lockPath = options.lockPath ?? defaultLockPath
  const vendorDir = options.vendorDir ?? defaultVendorDir
  const platformKey = options.platformKey ?? runtimePlatformKey()
  const downloader = options.download ?? download
  const lock = options.lock ?? loadRuntimeLock(lockPath)
  const layout = runtimeLayout(vendorDir, options.windows ?? process.platform === 'win32')
  const expected = stampFor(lock, platformKey)
  if (
    stampMatches(readStamp(layout.stamp), expected)
    && existsSync(layout.bun)
    && existsSync(layout.node)
  ) {
    return { skipped: true, layout, platformKey }
  }

  mkdirSync(layout.cacheDir, { recursive: true })
  for (const name of ['bun', 'node']) {
    const target = lock[name]?.targets?.[platformKey]
    if (target === undefined) {
      throw new Error(`dsh-desktop: lock has no ${name} target for ${platformKey}`)
    }
    const filename = target.url.split('/').pop()
    const archivePath = join(layout.cacheDir, filename)
    let body
    if (existsSync(archivePath) && sha256(readFileSync(archivePath)) === target.sha256) {
      body = readFileSync(archivePath)
    } else {
      body = await downloader(target.url)
      if (sha256(body) !== target.sha256) {
        throw new Error(`dsh-desktop: sha256 mismatch for ${filename}`)
      }
      writeFileSync(archivePath, body)
    }
    extractMember(archivePath, archiveKind(target.url), target.archiveMember, layout[name])
  }
  writeFileSync(layout.stamp, `${JSON.stringify(expected, null, 2)}\n`)
  return { skipped: false, layout, platformKey }
}

const invoked = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (invoked) {
  fetchRuntimes().then(result => {
    process.stderr.write(
      `dsh-desktop: ${result.skipped ? 'using cached' : 'fetched'} ${result.platformKey} runtimes in ${result.layout.vendorDir}\n`,
    )
  }).catch(cause => {
    process.stderr.write(`dsh-desktop: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}
