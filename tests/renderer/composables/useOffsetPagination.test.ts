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
