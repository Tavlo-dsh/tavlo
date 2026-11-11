import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { DESKTOP_VERSION_ENDPOINT } from './update-checker.ts'

export const DESKTOP_DOWNLOAD_URLS = {
  darwin: 'https://www.dshdesktop.cn/api/downloads/mac',
  win32: 'https://www.dshdesktop.cn/api/downloads/windows',
} as const

export const MAX_UPDATE_DOWNLOAD_BYTES = 1024 * 1024 * 1024
const PRIVATE_FILE_MODE = 0o600

export type UpdateArtifactRequest = (url: string, init: RequestInit) => Promise<Response>

export class UpdateDownloadError extends Error {
  readonly code: 'empty-body' | 'http-status' | 'network' | 'response-too-large' | 'cancelled' | 'invalid-artifact'
  constructor(
    code: UpdateDownloadError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'UpdateDownloadError'
    this.code = code
  }
}

const EXCEEDS_LIMIT_MESSAGE = 'The update installer exceeds 1073741824 bytes.'
const CANCELLED_MESSAGE = 'The update installer download was cancelled.'

/** Verify the platform installer signature: `koly` (UDIF) on darwin, MZ + PE on win32. */
export function verifyUpdateInstaller(platform: 'darwin' | 'win32', bytes: Buffer): void {
  if (platform === 'darwin') {
    const ok = bytes.length >= 512 && bytes.subarray(bytes.length - 512, bytes.length - 508).equals(Buffer.from('koly'))
    if (!ok) throw new UpdateDownloadError('invalid-artifact', 'The downloaded file is not a UDIF disk image.')
    return
  }
  const mz = bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a
  if (!mz) throw new UpdateDownloadError('invalid-artifact', 'The downloaded file is not a PE executable.')
  if (bytes.length < 0x40) throw new UpdateDownloadError('invalid-artifact', 'The downloaded file is not a PE executable.')
  const peOffset = bytes.readUInt32LE(0x3c)
  const pe = peOffset + 4 <= bytes.length
    && bytes[peOffset] === 0x50
    && bytes[peOffset + 1] === 0x45
    && bytes[peOffset + 2] === 0x00
    && bytes[peOffset + 3] === 0x00
  if (!pe) throw new UpdateDownloadError('invalid-artifact', 'The downloaded file is not a PE executable.')
}

export async function downloadDesktopUpdate(options: {
  readonly platform: 'darwin' | 'win32'
  readonly version: string
  readonly destinationPath: string
  readonly request: UpdateArtifactRequest
  readonly signal?: AbortSignal
}): Promise<string> {
  if (options.signal?.aborted) {
    throw new UpdateDownloadError('cancelled', CANCELLED_MESSAGE)
  }
  let response: Response
  try {
    response = await options.request(DESKTOP_DOWNLOAD_URLS[options.platform], {
      method: 'GET',
      redirect: 'error',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch {
    if (options.signal?.aborted) throw new UpdateDownloadError('cancelled', CANCELLED_MESSAGE)
    throw new UpdateDownloadError('network', 'update download failed')
  }
  if (response.status !== 200) {
    throw new UpdateDownloadError('http-status', `unexpected status ${String(response.status)}`)
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_UPDATE_DOWNLOAD_BYTES)) {
    throw new UpdateDownloadError('response-too-large', EXCEEDS_LIMIT_MESSAGE)
  }
  const partialPath = `${options.destinationPath}.${String(process.pid)}.${randomUUID()}.partial`
  await mkdir(dirname(options.destinationPath), { recursive: true })
  const stream = createWriteStream(partialPath, { mode: PRIVATE_FILE_MODE, flags: 'wx' })
  const cleanup = async (): Promise<void> => {
    stream.destroy()
    await rm(partialPath, { force: true }).catch(() => undefined)
  }
  try {
    let bytesWritten = 0
    if (response.body === null) {
      const body = Buffer.from(await response.arrayBuffer())
      bytesWritten = body.byteLength
      if (bytesWritten === 0) throw new UpdateDownloadError('empty-body', 'installer body was empty')
      if (bytesWritten > MAX_UPDATE_DOWNLOAD_BYTES) {
        throw new UpdateDownloadError('response-too-large', EXCEEDS_LIMIT_MESSAGE)
      }
      stream.write(body)
    } else {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytesWritten += value.byteLength
        if (bytesWritten > MAX_UPDATE_DOWNLOAD_BYTES) {
          await reader.cancel().catch(() => undefined)
          throw new UpdateDownloadError('response-too-large', EXCEEDS_LIMIT_MESSAGE)
        }
        if (!stream.write(Buffer.from(value))) {
          await new Promise<void>(resolve => {
            stream.once('drain', () => { resolve() })
          })
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((error: Error | null | undefined) => {
        if (error) reject(error)
        else resolve()
      })
    })
    if (bytesWritten === 0) throw new UpdateDownloadError('empty-body', 'installer body was empty')
    if (options.signal?.aborted) throw new UpdateDownloadError('cancelled', CANCELLED_MESSAGE)
    const artifact = await readFile(partialPath)
    verifyUpdateInstaller(options.platform, artifact)
    await rename(partialPath, options.destinationPath)
    return options.destinationPath
  } catch (cause) {
    await cleanup()
    if (options.signal?.aborted && !(cause instanceof UpdateDownloadError && cause.code === 'cancelled')) {
      throw new UpdateDownloadError('cancelled', CANCELLED_MESSAGE)
    }
    throw cause
  }
}

void DESKTOP_VERSION_ENDPOINT
