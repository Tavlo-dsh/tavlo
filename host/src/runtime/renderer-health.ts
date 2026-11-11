import type { RendererBootReport } from './types.ts'

export type RendererHealthFailureReason = 'renderer-failed' | 'renderer-timeout'

export type RendererHealthVerdict =
  | { readonly report: Extract<RendererBootReport, { status: 'healthy' }> }
  | {
      readonly report: Extract<RendererBootReport, { status: 'failed' }>
      readonly failureReason: RendererHealthFailureReason
    }

export interface DesktopRendererHealthGateOptions {
  readonly commitHealthy: () => Promise<void>
}

type GatePhase = 'idle' | 'monitoring' | 'committing' | 'settled' | 'stopped'

export class DesktopRendererHealthGate {
  private phase: GatePhase = 'idle'
  private nativeMounted = false
  private rendererHealthy = false
  private timer: NodeJS.Timeout | undefined
  private resolveVerdict: ((verdict: RendererHealthVerdict) => void) | undefined
  private rejectVerdict: ((cause: unknown) => void) | undefined
  private bootFailureReason: RendererHealthFailureReason | undefined

  constructor(private readonly options: DesktopRendererHealthGateOptions) {}

  get failureReason(): RendererHealthFailureReason | undefined {
    return this.bootFailureReason
  }

  begin(timeoutMs: number): Promise<RendererHealthVerdict> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('dsh-plugin-desktop: renderer boot timeout must be a positive integer')
    }
    if (this.phase !== 'idle') {
      throw new Error('dsh-plugin-desktop: renderer boot monitoring already started')
    }
    this.phase = 'monitoring'
    const verdict = new Promise<RendererHealthVerdict>((resolve, reject) => {
      this.resolveVerdict = resolve
      this.rejectVerdict = reject
    })
    this.timer = setTimeout(() => {
      this.fail(
        'renderer-timeout',
        `The Renderer did not report boot health within ${String(timeoutMs)}ms.`,
      )
    }, timeoutMs)
    this.timer.unref()
    return verdict
  }

  report(report: RendererBootReport): void {
    if (this.phase !== 'monitoring') return
    if (report.status === 'failed') {
      this.settleFailure('renderer-failed', report)
      return
    }
    if (this.rendererHealthy) return
    this.rendererHealthy = true
    this.commitIfEligible()
  }

  fail(reason: RendererHealthFailureReason, error: string): void {
    if (this.phase !== 'monitoring') return
    this.settleFailure(reason, { status: 'failed', plugins: [], error })
  }

  acceptNativeMount(): void {
    if (this.phase !== 'monitoring' || this.nativeMounted) return
    this.nativeMounted = true
    this.commitIfEligible()
  }

  stop(cause: unknown = new Error('dsh-plugin-desktop: renderer health monitoring stopped')): void {
    if (this.phase !== 'monitoring') return
    this.phase = 'stopped'
    this.clearTimer()
    this.rejectVerdict?.(cause)
    this.releaseSettlement()
  }

  private commitIfEligible(): void {
    if (this.phase !== 'monitoring' || !this.nativeMounted || !this.rendererHealthy) return
    this.phase = 'committing'
    this.clearTimer()
    void Promise.resolve().then(() => this.options.commitHealthy()).then(
      () => {
        if (this.phase !== 'committing') return
        this.phase = 'settled'
        this.resolveVerdict?.({ report: { status: 'healthy' } })
        this.releaseSettlement()
      },
      (cause: unknown) => {
        if (this.phase !== 'committing') return
        this.phase = 'settled'
        this.rejectVerdict?.(cause)
        this.releaseSettlement()
      },
    )
  }

  private settleFailure(
    reason: RendererHealthFailureReason,
    report: Extract<RendererBootReport, { status: 'failed' }>,
  ): void {
    if (this.phase !== 'monitoring') return
    this.phase = 'settled'
    this.bootFailureReason = reason
    this.clearTimer()
    this.resolveVerdict?.({ report, failureReason: reason })
    this.releaseSettlement()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private releaseSettlement(): void {
    this.resolveVerdict = undefined
    this.rejectVerdict = undefined
  }
}
