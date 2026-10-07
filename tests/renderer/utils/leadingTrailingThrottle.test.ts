import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leadingTrailingThrottle } from '../../../src/renderer/src/utils/leadingTrailingThrottle'

describe('leadingTrailingThrottle', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs the first call at once and one trailing call for a burst', () => {
    const fn = vi.fn()
    const throttle = leadingTrailingThrottle(fn, 1000)

    throttle.call()
    throttle.call()
    throttle.call()
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(2)

    // Nothing arrived since the trailing run: no further call.
    vi.advanceTimersByTime(5000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('runs at most once per interval while calls keep arriving', () => {
    const fn = vi.fn()
    const throttle = leadingTrailingThrottle(fn, 1000)

    for (let elapsed = 0; elapsed < 3000; elapsed += 100) {
      throttle.call()
      vi.advanceTimersByTime(100)
    }
    // Leading call plus one per elapsed second.
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('runs immediately again after a quiet interval', () => {
    const fn = vi.fn()
    const throttle = leadingTrailingThrottle(fn, 1000)

    throttle.call()
    vi.advanceTimersByTime(1000)
    throttle.call()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel drops a pending trailing call', () => {
    const fn = vi.fn()
    const throttle = leadingTrailingThrottle(fn, 1000)

    throttle.call()
    throttle.call()
    throttle.cancel()
    vi.advanceTimersByTime(2000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
