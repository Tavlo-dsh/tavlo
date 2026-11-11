import { describe, expect, it } from 'vitest'
import { applyNativeFolderDrop, createFilePathBridge } from '../src/runtime/file-path-bridge.ts'

describe('native folder drop bridge', () => {
  it('accepts exactly one path from the Tauri interceptor', () => {
    const pending: { path?: string } = {}
    expect(applyNativeFolderDrop(pending, { paths: ['/Users/me/proj'], x: 10, y: 20 })).toBe('/Users/me/proj')
    expect(pending.path).toBe('/Users/me/proj')
    expect(applyNativeFolderDrop(pending, { paths: ['/a', '/b'], x: 0, y: 0 })).toBeUndefined()
    expect(pending.path).toBeUndefined()
  })

  it('prefers a tagged File path and falls back to the pending native path', () => {
    const pending: { path?: string } = { path: '/pending' }
    const bridge = createFilePathBridge(pending)
    const tagged = { __dshPath: '/tagged' } as unknown as File
    expect(bridge.getPathForFile(tagged)).toBe('/tagged')
    expect(bridge.getPathForFile({} as File)).toBe('/pending')
  })
})
