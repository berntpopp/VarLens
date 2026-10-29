/**
 * When a desktop platform session locks (#295): after `idleLockMinutes`
 * without input, after `maxSessionMinutes` at the latest, and when the
 * operating system locks the screen or suspends. A timer checks every 30
 * seconds; the OS events lock at once. Linux has no lock-screen event, so the
 * idle state "locked" covers it there.
 */
export interface LockSignals {
  /** Seconds since the last input on this computer. */
  idleSeconds(): number
  /** The OS view of the session: 'locked' while the screen is locked. */
  idleState(): 'active' | 'idle' | 'locked' | 'unknown'
  /** Subscribe to screen lock and suspend; returns the unsubscribe. */
  onOsLock(listener: () => void): () => void
}

export type LockReason = 'inactivity' | 'maximum session' | 'screen lock' | 'user'

export interface SessionLockDependencies {
  signals: LockSignals
  idleLockMinutes: number
  maxSessionMinutes: number
  lock: (reason: LockReason) => void
  now?: () => number
  intervalMs?: number
}

export class SessionLock {
  private timer: ReturnType<typeof setInterval> | undefined
  private unsubscribe: (() => void) | undefined
  private signedInAt = 0

  constructor(private readonly deps: SessionLockDependencies) {}

  get running(): boolean {
    return this.timer !== undefined
  }

  start(signedInAt: number): void {
    this.stop()
    this.signedInAt = signedInAt
    this.unsubscribe = this.deps.signals.onOsLock(() => this.trigger('screen lock'))
    this.timer = setInterval(() => this.check(), this.deps.intervalMs ?? 30_000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  /** One check; the timer calls it, tests call it directly. */
  check(): void {
    const now = this.deps.now?.() ?? Date.now()
    if (now - this.signedInAt >= this.deps.maxSessionMinutes * 60_000) {
      this.trigger('maximum session')
    } else if (this.deps.signals.idleState() === 'locked') {
      this.trigger('screen lock')
    } else if (this.deps.signals.idleSeconds() >= this.deps.idleLockMinutes * 60) {
      this.trigger('inactivity')
    }
  }

  private trigger(reason: LockReason): void {
    if (!this.running) return
    this.stop()
    this.deps.lock(reason)
  }
}
