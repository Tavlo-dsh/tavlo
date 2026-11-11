import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { decodeMessage, NATIVE_METHODS } from '../src/rpc/protocol.ts'
import { createStdioTransport } from '../src/rpc/stdio.ts'
import { IpcDesktopRuntime } from '../src/runtime/ipc-desktop-runtime.ts'

describe('IpcDesktopRuntime stdio wire', () => {
  it('encodes tray upsert as a request line that native decode_message can dispatch', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let text = ''
    output.on('data', chunk => { text += String(chunk) })
    const transport = createStdioTransport(input, output)
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.registerTrayItem({
      group: 'tools',
      order: 10,
      label: () => 'Open Terminal',
      invoke: () => {},
    })
    await new Promise(resolve => setImmediate(resolve))
    const line = text.split('\n').find(item => item.includes('shell.tray.upsert'))
    expect(line).toBeDefined()
    const message = decodeMessage(`${line}\n`)
    expect(message.type).toBe('req')
    if (message.type !== 'req') throw new Error('expected req')
    expect(message.method).toBe(NATIVE_METHODS.trayUpsert)
    expect(message.params).toMatchObject({
      id: 'tray-1',
      group: 'tools',
      label: 'Open Terminal',
    })
    runtime.dispose()
  })

  it('encodes openTerminal as a request, not an event', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let text = ''
    output.on('data', chunk => { text += String(chunk) })
    const transport = createStdioTransport(input, output)
    const runtime = new IpcDesktopRuntime(transport, { platform: 'darwin' })
    runtime.configureTerminal({
      profileName: 'desktop',
      profileDir: '/tmp/profile',
      homeDir: '/tmp/home',
    })
    runtime.openTerminal()
    await new Promise(resolve => setImmediate(resolve))
    const message = decodeMessage(text)
    expect(message.type).toBe('req')
    if (message.type !== 'req') throw new Error('expected req')
    expect(message.method).toBe(NATIVE_METHODS.openTerminal)
    runtime.dispose()
  })
})

