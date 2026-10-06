import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withSetup } from '../../utils/test-helpers'
import { useDelayedFlag } from '@renderer/composables/useDelayedFlag'
import { useTableLoadingState } from '@renderer/composables/useTableLoadingState'

describe('useDelayedFlag', () => {
  let app: { unmount: () => void } | undefined

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    app?.unmount()
    vi.useRealTimers()
  })

  it('stays hidden for responses faster than the delay', async () => {
    const source = ref(false)
    const [flag, a] = withSetup(() => useDelayedFlag(source, { delayMs: 150, minVisibleMs: 300 }))
    app = a
    source.value = true
    await nextTick()
    vi.advanceTimersByTime(140)
    source.value = false
    await nextTick()
    vi.advanceTimersByTime(500)
    expect(flag.value).toBe(false)
  })

  it('shows after the delay and stays visible for the minimum duration', async () => {
    const source = ref(false)
    const [flag, a] = withSetup(() => useDelayedFlag(source, { delayMs: 150, minVisibleMs: 300 }))
    app = a
    source.value = true
    await nextTick()
    vi.advanceTimersByTime(150)
    expect(flag.value).toBe(true)

    vi.advanceTimersByTime(50)
    source.value = false
    await nextTick()
    expect(flag.value).toBe(true)
    vi.advanceTimersByTime(249)
    expect(flag.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(flag.value).toBe(false)
  })

  it('hides immediately when the minimum duration already elapsed', async () => {
    const source = ref(false)
    const [flag, a] = withSetup(() => useDelayedFlag(source))
    app = a
    source.value = true
    await nextTick()
    vi.advanceTimersByTime(1000)
    source.value = false
    await nextTick()
    expect(flag.value).toBe(false)
  })

  it('does not blink when loading restarts during the minimum-visible window', async () => {
    const source = ref(true)
    const [flag, a] = withSetup(() => useDelayedFlag(source))
    app = a
    vi.advanceTimersByTime(150)
    source.value = false
    await nextTick()
    source.value = true
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(flag.value).toBe(true)
  })
})

describe('useTableLoadingState', () => {
  let app: { unmount: () => void } | undefined

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    app?.unmount()
    vi.useRealTimers()
  })

  function setup(initialLoading = true) {
    const loading = ref(initialLoading)
    const totalCount = ref<number | null>(0)
    const [state, a] = withSetup(() => useTableLoadingState({ loading, totalCount }))
    app = a
    return { loading, totalCount, state }
  }

  it('treats the very first load as firstLoad (skeleton), later loads as refetch', async () => {
    const { loading, totalCount, state } = setup()
    expect(state.firstLoad.value).toBe(true)
    expect(state.refetching.value).toBe(false)

    totalCount.value = 6399
    loading.value = false
    await nextTick()
    loading.value = true
    await nextTick()

    expect(state.firstLoad.value).toBe(false)
    expect(state.refetching.value).toBe(true)
    expect(state.ariaBusy.value).toBe('true')
  })

  it('dims stale rows only after the delay', async () => {
    const { loading, state } = setup()
    loading.value = false
    await nextTick()
    loading.value = true
    await nextTick()
    expect(state.showStale.value).toBe(false)
    vi.advanceTimersByTime(150)
    expect(state.showStale.value).toBe(true)
  })

  it('announces the result count politely after each load', async () => {
    const { loading, totalCount, state } = setup()
    totalCount.value = 1234
    loading.value = false
    await nextTick()
    expect(state.liveMessage.value).toBe(`${(1234).toLocaleString()} variants`)
    expect(state.ariaBusy.value).toBe('false')
  })

  it('returns to firstLoad after a scope reset', async () => {
    const { loading, state } = setup()
    loading.value = false
    await nextTick()
    state.resetFirstLoad()
    loading.value = true
    await nextTick()
    expect(state.firstLoad.value).toBe(true)
  })

  it('a table that starts idle (shortlist) still skeletons on its first fetch', async () => {
    const { loading, state } = setup(false)
    loading.value = true
    await nextTick()
    expect(state.firstLoad.value).toBe(true)
  })
})
