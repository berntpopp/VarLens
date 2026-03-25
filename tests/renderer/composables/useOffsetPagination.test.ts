/**
 * Unit tests for useOffsetPagination composable.
 *
 * Verifies pagination state management and that items are stored as a
 * shallow-reactive array (not deep reactive) for performance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isReactive } from 'vue'
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
    expect(result.loading.value).toBe(false)
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
