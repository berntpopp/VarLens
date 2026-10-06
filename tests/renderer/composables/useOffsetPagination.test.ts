/**
 * Unit tests for useOffsetPagination composable.
 *
 * Verifies pagination state management and that items are stored as a
 * shallow-reactive array (not deep reactive) for performance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isReactive, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { withSetup, flushPromises } from '../../utils/test-helpers'
import { useOffsetPagination } from '@renderer/composables/useOffsetPagination'
import type { OffsetPageResult } from '@renderer/composables/useOffsetPagination'
import { useSettingsStore } from '@renderer/stores/settingsStore'

type MockItem = { id: number; name: string; nested: { value: number } }

function makeFetchPage(items: MockItem[], total: number) {
  return vi
    .fn()
    .mockResolvedValue({ data: items, total_count: total } as OffsetPageResult<MockItem>)
}

describe('useOffsetPagination', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('returns empty items and zero totalCount initially', () => {
    const fetchPage = makeFetchPage([], 0)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    expect(result.items.value).toEqual([])
    expect(result.totalCount.value).toBe(0)
    expect(result.loading.value).toBe(true)
    expect(result.error.value).toBeNull()
  })

  it('loads items and totalCount after loadPage', async () => {
    const mockItems: MockItem[] = [
      { id: 1, name: 'Alpha', nested: { value: 10 } },
      { id: 2, name: 'Beta', nested: { value: 20 } }
    ]
    const fetchPage = makeFetchPage(mockItems, 42)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    await flushPromises()

    expect(result.items.value).toHaveLength(2)
    expect(result.items.value[0].id).toBe(1)
    expect(result.totalCount.value).toBe(42)
    expect(result.loading.value).toBe(false)
  })

  it('items array is NOT deeply reactive (shallowRef behaviour)', async () => {
    const mockItems: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    const fetchPage = makeFetchPage(mockItems, 1)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    await flushPromises()

    // The individual item objects must NOT be reactive proxies.
    // With shallowRef the array itself is tracked but its elements are plain objects.
    const firstItem = result.items.value[0]
    expect(isReactive(firstItem)).toBe(false)
    expect(isReactive(firstItem.nested)).toBe(false)
  })

  it('clears items on resetState', async () => {
    const mockItems: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    const fetchPage = makeFetchPage(mockItems, 1)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    await flushPromises()
    expect(result.items.value).toHaveLength(1)

    result.resetState()
    expect(result.items.value).toEqual([])
    expect(result.totalCount.value).toBe(0)
    expect(result.page.value).toBe(1)
  })

  it('resets to page 1 on invalidateAndReload', async () => {
    const fetchPage = makeFetchPage([], 0)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    result.page.value = 5
    await result.invalidateAndReload()
    await flushPromises()

    expect(result.page.value).toBe(1)
    expect(fetchPage).toHaveBeenCalled()
  })

  it('sets error ref when fetchPage rejects', async () => {
    const fetchPage = vi.fn().mockRejectedValue(new Error('network error'))
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    await flushPromises()

    expect(result.error.value).toBeInstanceOf(Error)
    expect(result.error.value?.message).toBe('network error')
    expect(result.items.value).toEqual([])
    expect(result.totalCount.value).toBe(0)
  })
})

describe('predictive pre-fetch', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  it('pre-fetches page N+1 after loading page N when enabled', async () => {
    // 3 pages of 10 items each (total=30), start on page 1
    const mockItems: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    const fetchPage = makeFetchPage(mockItems, 30)

    const [result, appInstance] = withSetup(() => {
      const settings = useSettingsStore()
      settings.prefetchEnabled = true
      return useOffsetPagination({ fetchPage })
    })
    app = appInstance

    result.itemsPerPage.value = 10
    result.page.value = 1

    await result.loadPage()
    await flushPromises()

    // fetchPage should have been called twice:
    // once for page 1 (offset 0) and once for the pre-fetch of page 2 (offset 10)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(fetchPage).toHaveBeenCalledWith(expect.objectContaining({ offset: 0, limit: 10 }))
    expect(fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 10, limit: 10, skipCount: true })
    )
  })

  it('does not pre-fetch when prefetchEnabled is false', async () => {
    const mockItems: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    const fetchPage = makeFetchPage(mockItems, 30)

    const [result, appInstance] = withSetup(() => {
      const settings = useSettingsStore()
      settings.prefetchEnabled = false
      return useOffsetPagination({ fetchPage })
    })
    app = appInstance

    result.itemsPerPage.value = 10
    result.page.value = 1

    await result.loadPage()
    await flushPromises()

    // Only the primary fetch — no pre-fetch
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('does not pre-fetch when hidden-work gating disables it', async () => {
    const mockItems: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    const fetchPage = makeFetchPage(mockItems, 30)
    const prefetchEnabled = ref(false)

    const [result, appInstance] = withSetup(() => {
      const settings = useSettingsStore()
      settings.prefetchEnabled = true
      return useOffsetPagination({ fetchPage, prefetchEnabled })
    })
    app = appInstance

    result.itemsPerPage.value = 10
    result.page.value = 1

    await result.loadPage()
    await flushPromises()

    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('serves pre-fetched data from cache on next page navigation', async () => {
    const page1Items: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    const page2Items: MockItem[] = [{ id: 2, name: 'Beta', nested: { value: 20 } }]

    // fetchPage returns different data based on offset
    const fetchPage = vi.fn().mockImplementation(({ offset }: { offset: number }) => {
      if (offset === 0) {
        return Promise.resolve({ data: page1Items, total_count: 20 } as OffsetPageResult<MockItem>)
      }
      return Promise.resolve({ data: page2Items, total_count: 20 } as OffsetPageResult<MockItem>)
    })

    const [result, appInstance] = withSetup(() => {
      const settings = useSettingsStore()
      settings.prefetchEnabled = true
      return useOffsetPagination({ fetchPage })
    })
    app = appInstance

    result.itemsPerPage.value = 10

    // Load page 1 — triggers pre-fetch of page 2
    result.page.value = 1
    await result.loadPage()
    await flushPromises()

    // fetchPage called twice: page 1 + pre-fetch page 2
    expect(fetchPage).toHaveBeenCalledTimes(2)

    // Navigate to page 2 — should use the cached pre-fetch
    result.page.value = 2
    await result.loadPage()
    await flushPromises()

    // Still 2 calls — page 2 was served from cache
    // (page 3 pre-fetch would be a new call, but total = 20 so page 3 offset=20 >= total)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result.items.value[0].id).toBe(2)
  })

  it('clears cache on sort change', async () => {
    const mockItems: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    const fetchPage = makeFetchPage(mockItems, 30)

    const [result, appInstance] = withSetup(() => {
      const settings = useSettingsStore()
      settings.prefetchEnabled = true
      return useOffsetPagination({ fetchPage })
    })
    app = appInstance

    result.itemsPerPage.value = 10
    result.page.value = 1

    // Load page 1 — triggers pre-fetch of page 2
    await result.loadPage()
    await flushPromises()

    const callsAfterFirstLoad = fetchPage.mock.calls.length // 2 (fetch + pre-fetch)
    expect(callsAfterFirstLoad).toBe(2)

    // Change sort — cache should be cleared
    result.sortBy.value = [{ key: 'name', order: 'asc' }]
    await flushPromises()

    // Load page 1 again after sort change — must issue a fresh fetch (not use stale cache)
    result.page.value = 1
    await result.loadPage()
    await flushPromises()

    // At least one new fetch should have occurred after the sort change
    expect(fetchPage.mock.calls.length).toBeGreaterThan(callsAfterFirstLoad)

    // The fetch after sort change should use the new sort key
    const callsAfterSort = fetchPage.mock.calls.slice(callsAfterFirstLoad)
    const sortedCall = callsAfterSort.find(
      (call: Parameters<typeof fetchPage>[0][]) =>
        (call[0] as Parameters<typeof fetchPage>[0]).sortBy?.length > 0
    )
    expect(sortedCall).toBeDefined()
  })

  it('does not pre-fetch when already on the last page', async () => {
    const mockItems: MockItem[] = [{ id: 1, name: 'Alpha', nested: { value: 10 } }]
    // total=10, itemsPerPage=10: only one page exists
    const fetchPage = makeFetchPage(mockItems, 10)

    const [result, appInstance] = withSetup(() => {
      const settings = useSettingsStore()
      settings.prefetchEnabled = true
      return useOffsetPagination({ fetchPage })
    })
    app = appInstance

    result.itemsPerPage.value = 10
    result.page.value = 1

    await result.loadPage()
    await flushPromises()

    // Only the primary fetch — no next page to pre-fetch
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})

describe('request ordering and resilience', () => {
  let app: { unmount: () => void }

  beforeEach(() => {
    setActivePinia(createPinia())
    // Isolate the request-ordering contract from background prefetch calls.
    useSettingsStore().prefetchEnabled = false
  })

  afterEach(() => {
    if (app) app.unmount()
  })

  function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  const row = (id: number): MockItem => ({ id, name: `r${id}`, nested: { value: id } })

  it('latest request wins: a slow earlier response never overwrites a newer one', async () => {
    const slow = deferred<OffsetPageResult<MockItem>>()
    const fast = deferred<OffsetPageResult<MockItem>>()
    const fetchPage = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    result.page.value = 5
    const first = result.loadPage()
    result.page.value = 1
    const second = result.loadPage()

    fast.resolve({ data: [row(1)], total_count: 100 })
    await second
    expect(result.items.value.map((r) => r.id)).toEqual([1])
    expect(result.loading.value).toBe(false)

    slow.resolve({ data: [row(999)], total_count: 7 })
    await first
    await flushPromises()

    expect(result.items.value.map((r) => r.id)).toEqual([1])
    expect(result.totalCount.value).toBe(100)
  })

  it('keeps loading=true while a newer request is still pending', async () => {
    const first = deferred<OffsetPageResult<MockItem>>()
    const second = deferred<OffsetPageResult<MockItem>>()
    const fetchPage = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    const p1 = result.loadPage()
    result.page.value = 2
    const p2 = result.loadPage()

    first.resolve({ data: [row(1)], total_count: 10 })
    await p1
    expect(result.loading.value).toBe(true)
    expect(result.items.value).toEqual([])

    second.resolve({ data: [row(2)], total_count: 10 })
    await p2
    expect(result.loading.value).toBe(false)
    expect(result.items.value.map((r) => r.id)).toEqual([2])
  })

  it('keeps previous rows and total on error', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [row(1), row(2)], total_count: 2 })
      .mockRejectedValueOnce(new Error('boom'))
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    await result.invalidateAndReload()

    expect(result.error.value?.message).toBe('boom')
    expect(result.items.value.map((r) => r.id)).toEqual([1, 2])
    expect(result.totalCount.value).toBe(2)
  })

  it('never exposes NaN/undefined totals: missing count keeps the last known total', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [row(1)], total_count: 40 })
      .mockResolvedValueOnce({ data: [row(2)], total_count: undefined })
      .mockResolvedValueOnce({ data: [row(3)], total_count: Number.NaN })
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    await result.invalidateAndReload()
    expect(result.totalCount.value).toBe(40)
    await result.invalidateAndReload()
    expect(result.totalCount.value).toBe(40)
  })

  it('keeps the cached total when the count cache is reset mid-flight', async () => {
    const pending = deferred<OffsetPageResult<MockItem>>()
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [row(1)], total_count: 30 })
      .mockReturnValueOnce(pending.promise)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    result.page.value = 2
    const p = result.loadPage() // skipCount=true (count cached)
    result.resetCount() // filter change races in
    pending.resolve({ data: [row(2)], total_count: 0 })
    await p

    expect(Number.isFinite(result.totalCount.value)).toBe(true)
    expect(result.totalCount.value).toBe(30)
  })

  it('keeps the last known total visible while a fresh count is pending', async () => {
    const pending = deferred<OffsetPageResult<MockItem>>()
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [row(1)], total_count: 30 })
      .mockReturnValueOnce(pending.promise)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    await result.loadPage()
    const p = result.invalidateAndReload()
    expect(result.totalCount.value).toBe(30)
    pending.resolve({ data: [row(2)], total_count: 12 })
    await p
    expect(result.totalCount.value).toBe(12)
  })

  it('coalesces identical in-flight requests into one fetch', async () => {
    const pending = deferred<OffsetPageResult<MockItem>>()
    const fetchPage = vi.fn().mockReturnValue(pending.promise)
    const [result, appInstance] = withSetup(() => useOffsetPagination({ fetchPage }))
    app = appInstance

    const a = result.loadPage()
    const b = result.loadPage()
    pending.resolve({ data: [row(1)], total_count: 1 })
    await Promise.all([a, b])

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(result.items.value.map((r) => r.id)).toEqual([1])
  })
})
