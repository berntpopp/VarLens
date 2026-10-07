import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SUMMARY_STALE_POLL_MS,
  watchSummaryFreshness
} from '../../../src/renderer/src/composables/useSummaryFreshness'

describe('watchSummaryFreshness', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(statuses: boolean[]) {
    let emit: (status: { is_stale: boolean }) => void = () => {}
    const unsubscribe = vi.fn()
    const getSummaryStatus = vi.fn(async () => ({
      is_stale: statuses.length > 1 ? statuses.shift()! : statuses[0],
      last_rebuilt_at: 0
    }))
    const onFresh = vi.fn()
    const watcher = watchSummaryFreshness({
      cohortApi: {
        getSummaryStatus,
        onSummaryRebuilt: (callback: typeof emit) => {
          emit = callback
          return unsubscribe
        }
      } as never,
      onFresh
    })
    return {
      watcher,
      getSummaryStatus,
      onFresh,
      unsubscribe,
      emit: (s: boolean) => emit({ is_stale: s })
    }
  }

  it('asks until a stale summary is fresh again, then reports it once and stops asking', async () => {
    // PostgreSQL rebuilds in the background without sending an event.
    const ctx = setup([true, true, false])
    ctx.watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx.watcher.stale.value).toBe(true)
    expect(ctx.onFresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS)
    expect(ctx.watcher.stale.value).toBe(true)
    await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS)
    expect(ctx.watcher.stale.value).toBe(false)
    expect(ctx.onFresh).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS * 5)
    expect(ctx.getSummaryStatus).toHaveBeenCalledTimes(3)
  })

  it('does not poll a fresh summary', async () => {
    const ctx = setup([false])
    ctx.watcher.start()
    await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS * 3)
    expect(ctx.getSummaryStatus).toHaveBeenCalledTimes(1)
    expect(ctx.onFresh).not.toHaveBeenCalled()
  })

  it('follows the rebuild events as well (desktop sends them)', async () => {
    const ctx = setup([false])
    ctx.watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    ctx.emit(true)
    expect(ctx.watcher.stale.value).toBe(true)
    ctx.emit(false)
    expect(ctx.watcher.stale.value).toBe(false)
    expect(ctx.onFresh).toHaveBeenCalledTimes(1)
  })

  it('can be told that a response was stale, and stops cleanly', async () => {
    const ctx = setup([true])
    ctx.watcher.markStale()
    expect(ctx.watcher.stale.value).toBe(true)
    await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS)
    expect(ctx.getSummaryStatus).toHaveBeenCalledTimes(1)
    ctx.watcher.stop()
    await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS * 3)
    expect(ctx.getSummaryStatus).toHaveBeenCalledTimes(1)
  })

  it('keeps asking through a failed status call', async () => {
    const ctx = setup([true])
    ctx.getSummaryStatus.mockRejectedValueOnce(new Error('offline'))
    ctx.watcher.markStale()
    await vi.advanceTimersByTimeAsync(SUMMARY_STALE_POLL_MS * 2)
    expect(ctx.getSummaryStatus).toHaveBeenCalledTimes(2)
    expect(ctx.watcher.stale.value).toBe(true)
  })
})
