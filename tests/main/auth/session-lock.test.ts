import { describe, it, expect, vi } from 'vitest'
import { SessionLock, type LockSignals } from '../../../src/main/auth/session-lock'

function signals(): LockSignals & { idle: number; state: 'active' | 'locked'; fire: () => void } {
  let listener: (() => void) | undefined
  const s = {
    idle: 0,
    state: 'active' as 'active' | 'locked',
    idleSeconds: () => s.idle,
    idleState: () => s.state,
    onOsLock: (l: () => void) => {
      listener = l
      return () => (listener = undefined)
    },
    fire: () => listener?.()
  }
  return s
}

function setup() {
  const sig = signals()
  let now = 0
  const lock = vi.fn()
  const sessionLock = new SessionLock({
    signals: sig,
    idleLockMinutes: 15,
    maxSessionMinutes: 480,
    lock,
    now: () => now,
    intervalMs: 60_000
  })
  sessionLock.start(0)
  return { sig, lock, sessionLock, advance: (ms: number) => (now += ms) }
}

describe('session lock', () => {
  it('locks after the idle time and only once', () => {
    const { sig, lock, sessionLock } = setup()
    sig.idle = 14 * 60
    sessionLock.check()
    expect(lock).not.toHaveBeenCalled()
    sig.idle = 15 * 60
    sessionLock.check()
    sessionLock.check()
    expect(lock).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledWith('inactivity')
    expect(sessionLock.running).toBe(false)
  })

  it('locks at the maximum session length', () => {
    const { lock, sessionLock, advance } = setup()
    advance(480 * 60_000)
    sessionLock.check()
    expect(lock).toHaveBeenCalledWith('maximum session')
  })

  it('locks when the operating system locks the screen or suspends', () => {
    const first = setup()
    first.sig.fire()
    expect(first.lock).toHaveBeenCalledWith('screen lock')
    const second = setup()
    second.sig.state = 'locked'
    second.sessionLock.check()
    expect(second.lock).toHaveBeenCalledWith('screen lock')
  })

  it('does nothing once stopped', () => {
    const { sig, lock, sessionLock } = setup()
    sessionLock.stop()
    sig.fire()
    sig.idle = 3600
    sessionLock.check()
    expect(lock).not.toHaveBeenCalled()
  })
})
