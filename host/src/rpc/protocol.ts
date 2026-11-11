export const PROTOCOL_VERSION = 1 as const

export type RpcRequest = {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'req'
  readonly id: string
  readonly method: string
  readonly params?: unknown
}

export type RpcResponse = {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'res'
  readonly id: string
  readonly result?: unknown
}

export type RpcError = {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'err'
  readonly id: string
  readonly error: { readonly code: string, readonly message: string }
}

export type RpcEvent = {
  readonly v: typeof PROTOCOL_VERSION
  readonly type: 'evt'
  readonly method: string
  readonly params?: unknown
}

export type RpcMessage = RpcRequest | RpcResponse | RpcError | RpcEvent

export const NATIVE_METHODS = {
  schedule: 'shell.schedule',
  mount: 'shell.mount',
  release: 'shell.release',
  show: 'shell.show',
  notifyAttention: 'shell.notifyAttention',
  reloadRenderer: 'shell.reloadRenderer',
  toggleDeveloperTools: 'shell.toggleDeveloperTools',
  pickDirectory: 'shell.pickDirectory',
  validateDirectory: 'shell.validateDirectory',
  openDialog: 'shell.openDialog',
  openRecovery: 'shell.openRecovery',
  openProfileCreate: 'shell.openProfileCreate',
  openTerminal: 'shell.openTerminal',
  exportDiagnostics: 'shell.exportDiagnostics',
  setTheme: 'shell.setTheme',
  setLocale: 'shell.setLocale',
  trayUpsert: 'shell.tray.upsert',
  trayRemove: 'shell.tray.remove',
  notify: 'shell.notify',
  confirmUpdate: 'shell.confirmUpdate',
  showUpdateResult: 'shell.showUpdateResult',
  downloadUpdate: 'shell.downloadUpdate',
  restart: 'shell.restart',
  restartRecovery: 'shell.restartRecovery',
  prepareToQuit: 'shell.prepareToQuit',
  reportRendererBoot: 'shell.reportRendererBoot',
  writeBootstrap: 'shell.writeBootstrap',
  openDevtools: 'shell.openDevtools',
  revealItem: 'shell.revealItem',
  openUpdate: 'shell.openUpdate',
  saveDialog: 'shell.saveDialog',
} as const

export const NATIVE_EVENTS = {
  secondInstance: 'event.secondInstance',
  trayInvoke: 'event.trayInvoke',
  dropPaths: 'event.dropPaths',
  windowClose: 'event.windowClose',
  quit: 'event.quit',
  sidecarFailed: 'event.sidecarFailed',
} as const

export function encodeMessage(message: RpcMessage): string {
  return `${JSON.stringify(message)}\n`
}

export function decodeMessage(line: string): RpcMessage {
  const trimmed = line.trim()
  if (trimmed.length === 0) throw new Error('rpc: empty line')
  const value: unknown = JSON.parse(trimmed)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('rpc: message must be an object')
  }
  const record = value as Record<string, unknown>
  if (record.v !== PROTOCOL_VERSION) throw new Error('rpc: unsupported protocol version')
  if (record.type === 'req') {
    if (typeof record.id !== 'string' || typeof record.method !== 'string') {
      throw new Error('rpc: invalid request')
    }
    return {
      v: PROTOCOL_VERSION,
      type: 'req',
      id: record.id,
      method: record.method,
      ...(record.params === undefined ? {} : { params: record.params }),
    }
  }
  if (record.type === 'res') {
    if (typeof record.id !== 'string') throw new Error('rpc: invalid response')
    return {
      v: PROTOCOL_VERSION,
      type: 'res',
      id: record.id,
      ...(record.result === undefined ? {} : { result: record.result }),
    }
  }
  if (record.type === 'err') {
    if (typeof record.id !== 'string' || record.error === null || typeof record.error !== 'object') {
      throw new Error('rpc: invalid error')
    }
    const error = record.error as Record<string, unknown>
    if (typeof error.code !== 'string' || typeof error.message !== 'string') {
      throw new Error('rpc: invalid error payload')
    }
    return {
      v: PROTOCOL_VERSION,
      type: 'err',
      id: record.id,
      error: { code: error.code, message: error.message },
    }
  }
  if (record.type === 'evt') {
    if (typeof record.method !== 'string') throw new Error('rpc: invalid event')
    return {
      v: PROTOCOL_VERSION,
      type: 'evt',
      method: record.method,
      ...(record.params === undefined ? {} : { params: record.params }),
    }
  }
  throw new Error('rpc: unknown message type')
}
