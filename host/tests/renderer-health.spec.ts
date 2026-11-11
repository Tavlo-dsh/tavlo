import { describe, expect, it, vi } from 'vitest'
import { DesktopRendererHealthGate } from '../src/runtime/renderer-health.ts'

function deferredCommit(): { commit: () => void, commitHealthy: () => Promise<void> } {
  let release: () => void = () => undefined
  const committed = new Promise<void>(resolve => { release = resolve })
  return {
    commit: () => { release() },
    commitHealthy: vi.fn(() => committed),
  }
}

describe('Desktop renderer health gate', () => {
  it('commits healthy only after Renderer evidence and native mount are both ready', async () => {
    const { commit, commitHealthy } = deferredCommit()
    const gate = new DesktopRendererHealthGate({ commitHealthy })
    const verdict = gate.begin(30_000)
    gate.report({ status: 'healthy' })
    expect(commitHealthy).not.toHaveBeenCalled()
    gate.acceptNativeMount()
    await Promise.resolve()
    expect(commitHealthy).toHaveBeenCalled()
    commit()
    await expect(verdict).resolves.toEqual({ report: { status: 'healthy' } })
    expect(gate.failureReason).toBeUndefined()
  })

  it('commits healthy when native mount becomes ready before Renderer evidence', async () => {
    const { commit, commitHealthy } = deferredCommit()
    const gate = new DesktopRendererHealthGate({ commitHealthy })
    const verdict = gate.begin(30_000)
    gate.acceptNativeMount()
    expect(commitHealthy).not.toHaveBeenCalled()
    gate.report({ status: 'healthy' })
    await Promise.resolve()
    expect(commitHealthy).toHaveBeenCalled()
    commit()
    await expect(verdict).resolves.toEqual({ report: { status: 'healthy' } })
  })

  it('ignores evidence received before monitoring begins', async () => {
    const { commitHealthy } = deferredCommit()
    const gate = new DesktopRendererHealthGate({ commitHealthy })
    gate.report({ status: 'healthy' })
    gate.acceptNativeMount()
    const verdict = gate.begin(30_000)
    gate.acceptNativeMount()
    expect(commitHealthy).not.toHaveBeenCalled()
    gate.stop()
    await expect(verdict).rejects.toThrow('renderer health monitoring stopped')
  })

  it('keeps the first failure verdict when later healthy evidence arrives', async () => {
    const { commitHealthy } = deferredCommit()
    const gate = new DesktopRendererHealthGate({ commitHealthy })
    const verdict = gate.begin(30_000)
    gate.report({ status: 'failed', plugins: ['dsh-market'], error: 'loader exploded' })
    gate.report({ status: 'healthy' })
    gate.acceptNativeMount()
    const settled = await verdict
    expect(settled).toEqual({
      report: { status: 'failed', plugins: ['dsh-market'], error: 'loader exploded' },
      failureReason: 'renderer-failed',
    })
    expect(gate.failureReason).toBe('renderer-failed')
    expect(commitHealthy).not.toHaveBeenCalled()
  })

  it('settles a timeout once without committing healthy', async () => {
    vi.useFakeTimers()
    try {
      const { commitHealthy } = deferredCommit()
      const gate = new DesktopRendererHealthGate({ commitHealthy })
      const verdict = gate.begin(30_000)
      gate.acceptNativeMount()
      vi.advanceTimersByTime(30_000)
      const settled = await verdict
      if (!('failureReason' in settled)) throw new Error('expected the gate to time out')
      expect(settled.failureReason).toBe('renderer-timeout')
      expect(settled.report.status).toBe('failed')
      if (settled.report.status !== 'failed') throw new Error('unreachable')
      expect(settled.report.error).toBe('The Renderer did not report boot health within 30000ms.')
      expect(commitHealthy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects the verdict when the durable healthy commit fails', async () => {
    const gate = new DesktopRendererHealthGate({
      commitHealthy: () => Promise.reject(new Error('disk full')),
    })
    const verdict = gate.begin(30_000)
    gate.report({ status: 'healthy' })
    gate.acceptNativeMount()
    await expect(verdict).rejects.toThrow('disk full')
  })

  it('prevents later evidence from committing after monitoring stops', async () => {
    const { commitHealthy } = deferredCommit()
    const gate = new DesktopRendererHealthGate({ commitHealthy })
    const verdict = gate.begin(30_000)
    gate.stop()
    gate.report({ status: 'healthy' })
    gate.acceptNativeMount()
    expect(commitHealthy).not.toHaveBeenCalled()
    await expect(verdict).rejects.toThrow('renderer health monitoring stopped')
  })

  it('ignores duplicate reports while the first healthy commit is pending', async () => {
    const { commit, commitHealthy } = deferredCommit()
    const gate = new DesktopRendererHealthGate({ commitHealthy })
    const verdict = gate.begin(30_000)
    gate.report({ status: 'healthy' })
    gate.acceptNativeMount()
    gate.report({ status: 'healthy' })
    gate.report({ status: 'failed', plugins: [], error: 'late' })
    commit()
    await expect(verdict).resolves.toEqual({ report: { status: 'healthy' } })
    expect(commitHealthy).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-positive timeout', () => {
    const gate = new DesktopRendererHealthGate({ commitHealthy: async () => undefined })
    expect(() => gate.begin(0)).toThrow('timeout must be a positive integer')
    expect(() => gate.begin(-1)).toThrow('timeout must be a positive integer')
  })
})
