import { describe, expect, it } from 'vitest'
import { selectLatestDshTag, sourceVersionFromTag } from '../src/runtime/kernel-pin.ts'

describe('latest dsh-v* tag selection', () => {
  it('picks the highest semver dsh-v* tag from an unsorted mix of rc and alpha', () => {
    const tags = [
      'dsh-v0.1.1-rc.2',
      'dsh-v0.1.2-alpha.1',
      'dsh-v0.1.1-rc.1',
      'dsh-v0.1.0-rc.8',
    ]
    expect(selectLatestDshTag(tags)).toBe('dsh-v0.1.2-alpha.1')
    expect(selectLatestDshTag([...tags].reverse())).toBe('dsh-v0.1.2-alpha.1')
    expect(selectLatestDshTag([
      'dsh-v0.1.0-rc.8',
      'dsh-v0.1.1-rc.2',
      'dsh-v0.1.1-rc.1',
      'dsh-v0.1.2-alpha.1',
    ])).toBe('dsh-v0.1.2-alpha.1')
  })

  it('peels git ls-remote noise and ignores non dsh-v tags', () => {
    const tags = [
      'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e\trefs/tags/dsh-v0.1.1-rc.2',
      'cd5ef8148158c3a752a658978873241fdf8e2bbc\trefs/tags/dsh-v0.1.2-alpha.1^{}',
      'refs/tags/dsh-v0.1.1-rc.1',
      'dsh-v0.1.0-rc.8^{}',
      'v0.9.9',
      'origin/master',
      'refs/heads/master',
    ]
    expect(selectLatestDshTag(tags)).toBe('dsh-v0.1.2-alpha.1')
  })

  it('orders prereleases on the same patch (rc.2 > rc.1)', () => {
    expect(selectLatestDshTag(['dsh-v0.1.1-rc.1', 'dsh-v0.1.1-rc.2'])).toBe('dsh-v0.1.1-rc.2')
  })

  it('strips the dsh-v prefix for sourceVersion', () => {
    expect(sourceVersionFromTag('dsh-v0.1.2-alpha.1')).toBe('0.1.2-alpha.1')
    expect(sourceVersionFromTag('dsh-v0.1.1-rc.2')).toBe('0.1.1-rc.2')
  })

  it('throws when no dsh-v tags remain', () => {
    expect(() => selectLatestDshTag(['v1.0.0', 'refs/heads/master'])).toThrow(/dsh-v/)
    expect(() => sourceVersionFromTag('v0.1.1-rc.2')).toThrow(/dsh-v/)
  })
})
