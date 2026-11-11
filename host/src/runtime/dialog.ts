const DIALOG_SCHEME = 'dsh-desktop-dialog:'

export function parseDesktopDialogResponse(href: string, buttonCount: number): number | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  if (url.protocol !== DIALOG_SCHEME || url.hostname !== 'response'
    || url.username !== '' || url.password !== '' || url.port !== ''
    || url.pathname !== '' || url.hash !== ''
    || [...url.searchParams.keys()].some(key => key !== 'id')) return undefined
  const raw = url.searchParams.get('id')
  if (raw === null || !/^(?:0|[1-9]\d*)$/u.test(raw)) return undefined
  const response = Number(raw)
  return Number.isSafeInteger(response) && response >= 0 && response < buttonCount ? response : undefined
}

export function encodeDialogState(state: object): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

export function decodeDialogState<T>(encoded: string, maxBytes = 64_000): T | undefined {
  if (encoded.length > maxBytes) return undefined
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T
  } catch {
    return undefined
  }
}
