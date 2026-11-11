import { describe, expect, it } from 'vitest'
import { checkForStableUpdate, compareSemVerVersions, parseSemVer } from '../src/runtime/update-checker.ts'

describe('stable update checker', () => {
  it('compares canonical SemVer', () => {
    expect(parseSemVer('2.0.3')?.version).toBe('2.0.3')
    expect(compareSemVerVersions('2.0.3', '2.0.4')).toBeLessThan(0)
    expect(compareSemVerVersions('2.0.3', '2.0.3')).toBe(0)
  })

  it('reports an update when the service version is newer', async () => {
    const result = await checkForStableUpdate({
      currentVersion: '2.0.3',
      request: async () => new Response(JSON.stringify({ version: '2.1.0' }), { status: 200 }),
    })
    expect(result).toEqual({
      status: 'update-available',
      currentVersion: '2.0.3',
      latestVersion: '2.1.0',
    })
  })

  it('is silent on network or validation failure', async () => {
    expect(await checkForStableUpdate({
      currentVersion: '2.0.3',
      request: async () => { throw new Error('offline') },
    })).toBeNull()
    expect(await checkForStableUpdate({
      currentVersion: '2.0.3-beta.1',
      request: async () => new Response(JSON.stringify({ version: '2.1.0' }), { status: 200 }),
    })).toBeNull()
  })
})
