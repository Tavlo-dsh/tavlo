import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  downloadDesktopUpdate,
  UpdateDownloadError,
  verifyUpdateInstaller,
} from '../src/runtime/update-download.ts'

function udifArtifact(): Buffer {
  const bytes = Buffer.alloc(1024)
  bytes.write('koly', 1024 - 512, 'ascii')
  return bytes
}

function peArtifact(): Buffer {
  const bytes = Buffer.alloc(512)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80, 'ascii')
  return bytes
}

function jsonResponse(bytes: Buffer, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'application/octet-stream', ...headers },
  })
}

function tempDestination(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-update-'))
  return join(dir, 'DSH-Desktop-1.2.0-mac.dmg')
}

async function rejectUpdateDownload(options: Parameters<typeof downloadDesktopUpdate>[0]): Promise<UpdateDownloadError> {
  try {
    await downloadDesktopUpdate(options)
  } catch (cause) {
    if (cause instanceof UpdateDownloadError) return cause
    throw cause
  }
  throw new Error('expected downloadDesktopUpdate to reject')
}

describe('verifyUpdateInstaller', () => {
  it('accepts a UDIF disk image on darwin', () => {
    expect(() => verifyUpdateInstaller('darwin', udifArtifact())).not.toThrow()
  })

  it('rejects a non-UDIF artifact on darwin', () => {
    expect(() => verifyUpdateInstaller('darwin', Buffer.alloc(1024))).toThrow(
      'The downloaded file is not a UDIF disk image.',
    )
  })

  it('accepts a PE executable on win32', () => {
    expect(() => verifyUpdateInstaller('win32', peArtifact())).not.toThrow()
  })

  it('rejects a non-PE artifact on win32', () => {
    expect(() => verifyUpdateInstaller('win32', Buffer.alloc(512))).toThrow(
      'The downloaded file is not a PE executable.',
    )
    const missingSignature = peArtifact()
    missingSignature.write('XX\0\0', 0x80, 'ascii')
    expect(() => verifyUpdateInstaller('win32', missingSignature)).toThrow(
      'The downloaded file is not a PE executable.',
    )
  })
})

describe('downloadDesktopUpdate', () => {
  it('streams to a partial file, verifies it, and renames atomically', async () => {
    const destination = tempDestination()
    const artifact = udifArtifact()
    const path = await downloadDesktopUpdate({
      platform: 'darwin',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => jsonResponse(artifact),
    })
    expect(path).toBe(destination)
    expect(readFileSync(destination).equals(artifact)).toBe(true)
    const siblings = readdirSync(join(destination, '..')).filter(name => name.includes('.partial'))
    expect(siblings).toEqual([])
  })

  it('rejects an invalid artifact and leaves no partial behind', async () => {
    const destination = tempDestination()
    const error = await rejectUpdateDownload({
      platform: 'darwin',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => jsonResponse(Buffer.from('not a dmg at all')),
    })
    expect(error.message).toBe('The downloaded file is not a UDIF disk image.')
    expect(existsSync(destination)).toBe(false)
    expect(readdirSync(join(destination, '..')).filter(name => name.includes('.partial'))).toEqual([])
  })

  it('verifies PE installers on win32', async () => {
    const destination = tempDestination()
    const path = await downloadDesktopUpdate({
      platform: 'win32',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => jsonResponse(peArtifact()),
    })
    expect(readFileSync(path).equals(peArtifact())).toBe(true)
  })

  it('rejects a declared payload above 1 GiB without downloading', async () => {
    const destination = tempDestination()
    const error = await rejectUpdateDownload({
      platform: 'darwin',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => jsonResponse(Buffer.alloc(0), { 'content-length': String(1024 * 1024 * 1024 + 1) }),
    })
    expect(error.code).toBe('response-too-large')
    expect(error.message).toBe('The update installer exceeds 1073741824 bytes.')
    expect(existsSync(destination)).toBe(false)
  })

  it('reports a cancelled download and cleans the partial file', async () => {
    const destination = tempDestination()
    const controller = new AbortController()
    controller.abort()
    const error = await rejectUpdateDownload({
      platform: 'darwin',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => {
        throw new DOMException('aborted', 'AbortError')
      },
      signal: controller.signal,
    })
    expect(error.code).toBe('cancelled')
    expect(error.message).toBe('The update installer download was cancelled.')
    expect(existsSync(destination)).toBe(false)
  })

  it('rejects an empty body', async () => {
    const destination = tempDestination()
    const error = await rejectUpdateDownload({
      platform: 'darwin',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => jsonResponse(Buffer.alloc(0)),
    })
    expect(error.code).toBe('empty-body')
    expect(existsSync(destination)).toBe(false)
  })

  it('rejects a non-200 response', async () => {
    const destination = tempDestination()
    const error = await rejectUpdateDownload({
      platform: 'darwin',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => new Response('missing', { status: 404 }),
    })
    expect(error.code).toBe('http-status')
  })

  it('does not clobber an existing destination', async () => {
    const destination = tempDestination()
    writeFileSync(destination, 'existing')
    await rejectUpdateDownload({
      platform: 'darwin',
      version: '1.2.0',
      destinationPath: destination,
      request: async () => {
        throw new Error('network down')
      },
    })
    expect(readFileSync(destination, 'utf8')).toBe('existing')
  })
})
