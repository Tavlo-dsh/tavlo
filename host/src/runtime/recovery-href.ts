const RECOVERY_SCHEME = 'dsh-recovery:'

export interface RecoveryAction {
  readonly action: string
  readonly id?: string
  readonly name?: string
}

export function parseRecoveryHref(href: string): RecoveryAction | undefined {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }
  if (url.protocol !== RECOVERY_SCHEME || url.username !== '' || url.password !== '' || url.port !== '') {
    return undefined
  }
  const action = url.hostname
  if (action.length === 0) return undefined
  const allowed = new Set(['id', 'name'])
  if ([...url.searchParams.keys()].some(key => !allowed.has(key))) return undefined
  const id = url.searchParams.get('id') ?? undefined
  const name = url.searchParams.get('name') ?? undefined
  return {
    action,
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
  }
}

export const RECOVERY_ACTIONS = [
  'restart',
  'quit',
  'save-diagnostics',
  'show-diagnostics',
  'open-terminal',
  'add-profile',
  'switch-profile',
  'preview-disable',
  'rollback',
  'open-settings',
  'open-profile-patch',
  'open-profile-manifest',
  'open-profile-directory',
  'open-checkpoint',
] as const
