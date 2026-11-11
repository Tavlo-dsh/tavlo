export function runtimePlatformKey(platform?: string, arch?: string): string
export function runtimeLayout(vendorDir?: string, windows?: boolean): {
  vendorDir: string
  bun: string
  node: string
  stamp: string
  cacheDir: string
}
export function loadRuntimeLock(lockPath?: string): {
  bun: {
    version: string
    targets: Record<string, { url: string, sha256: string, archiveMember: string }>
  }
  node: {
    version: string
    targets: Record<string, { url: string, sha256: string, archiveMember: string }>
  }
}
export function stampFor(
  lock: ReturnType<typeof loadRuntimeLock>,
  platformKey: string,
): { bun: string, node: string, platform: string }
export function stampMatches(
  existing: { bun?: string, node?: string, platform?: string } | null | undefined,
  expected: { bun: string, node: string, platform: string },
): boolean
export function sha256(buffer: Uint8Array): string
export function fetchRuntimes(options?: {
  lockPath?: string
  vendorDir?: string
  platformKey?: string
  windows?: boolean
  lock?: ReturnType<typeof loadRuntimeLock>
  download?: (url: string) => Promise<Uint8Array>
}): Promise<{
  skipped: boolean
  layout: ReturnType<typeof runtimeLayout>
  platformKey: string
}>
