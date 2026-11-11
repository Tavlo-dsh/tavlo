import { describe, expect, it } from 'vitest'
import { parseDesktopDialogResponse } from '../src/runtime/dialog.ts'
import { parseRecoveryHref } from '../src/runtime/recovery-href.ts'

describe('native auxiliary window contracts', () => {
  it('parses a bounded dialog response', () => {
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=1', 2)).toBe(1)
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=2', 2)).toBeUndefined()
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=-1', 2)).toBeUndefined()
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=1&command=bad', 2)).toBeUndefined()
    expect(parseDesktopDialogResponse('https://response/?id=1', 2)).toBeUndefined()
  })

  it('parses recovery actions without extra query keys', () => {
    expect(parseRecoveryHref('dsh-recovery://restart')).toEqual({ action: 'restart' })
    expect(parseRecoveryHref('dsh-recovery://switch-profile?name=web')).toEqual({
      action: 'switch-profile',
      name: 'web',
    })
    expect(parseRecoveryHref('dsh-recovery://preview-disable?id=bundle_1&extra=1')).toBeUndefined()
    expect(parseRecoveryHref('https://restart')).toBeUndefined()
  })
})
