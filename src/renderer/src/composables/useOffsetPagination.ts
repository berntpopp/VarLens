/**
 * Shared composable for offset-based pagination with v-data-table-server.
 *
 * Replaces cursor-based pagination. Uses simple OFFSET = (page - 1) * limit.
 * Maps directly to Vuetify's page-number model — no cursor cache or gap-filling.
 *
 * DRY: Both case (VariantTable) and cohort (CohortTable) views use this composable.
 */

import { ref, shallowRef, watch, computed, type Ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { APP_CONFIG } from '../../../shared/config'
import { logService } from '../services/LogService'

export interface SortItem {
  key: string
  order: boolean | 'asc' | 'desc'
}

/** Normalized sort item with strict 'asc'/'desc' order (IPC-safe). */
export interface NormalizedSortItem {
  key: string
  order: 'asc' | 'desc'
}

/** Normalize Vuetify's boolean sort orders to 'asc'/'desc' for IPC safety. */
const normalizeOrder = (order: SortItem['order']): 'asc' | 'desc' => {
  if (order === 'desc' || order === false) return 'desc'
  return 'asc'
}

const normalizeSortBy = (items: SortItem[]): NormalizedSortItem[] =>
  items.map(({ key, order }) => ({ key, order: normalizeOrder(order) }))

export interface OffsetPageResult<T> {
  data: T[]
  total_count: number
}

export interface UseOffsetPaginationOptions<T> {
  /** Fetch a single page. sortBy is already normalized to 'asc'/'desc' (IPC-safe). */
  fetchPage: (params: {
    offset: number
    limit: number
    sortBy: NormalizedSortItem[]
    /** When true, the caller should skip the COUNT(*) query and reuse the cached value. */
    skipCount: boolean
  }) => Promise<OffsetPageResult<T>>
  /** Called when sort state changes (e.g. to update "has sort" indicator) */
  onSortChange?: (hasSort: boolean) => void
  /** Additional gate for background prefetch work while a kept-alive view is hidden. */
  prefetchEnabled?: Ref<boolean>
  /**
   * Serialized filter key. When provided, it is included in prefetch cache keys
   * so that cached results from a previous filter set are never served after a
   * filter change. The cache is also cleared automatically when this value changes.
   */
  filterKey?: Ref<string>
}

export function useOffsetPagination<T>(options: UseOffsetPaginationOptions<T>) {
  const settingsStore = useSettingsStore()

  // Table state — bind to v-data-table-server via v-model
  const page = ref(1)
  const itemsPerPage = ref(settingsStore.itemsPerPage)
  const sortBy = ref<SortItem[]>([])
  const itemsPerPageOptions = [...APP_CONFIG.ITEMS_PER_PAGE_OPTIONS]

  // Result state
  const items = shallowRef<T[]>([]) as Ref<T[]>
  const totalCount = ref(0)
  const loading = ref(true)
  const error = ref<Error | null>(null)

  // Sort change detection (prevents spurious reloads on reference changes)
  let prevSortSerialized = ''

  // Count cache — avoids redundant COUNT(*) queries on page navigation.
  // Invalidated via resetCount() when filters change.
  let cachedTotalCount: number | null = null

  // Pre-fetch cache: Map<cacheKey, Promise<result>>
  // Keyed by `offset:sortKey` so stale entries are naturally ignored after
  // sort/filter changes (which also call prefetchCache.clear()).
  const prefetchCache = new Map<string, Promise<OffsetPageResult<T>>>()

  function buildPrefetchKey(offset: number): string {
    const sortKey = JSON.stringify(normalizeSortBy(sortBy.value))
    const fKey = options.filterKey?.value ?? ''
    return `${offset}:${itemsPerPage.value}:${sortKey}:${fKey}`
  }

  /** Fire-and-forget: pre-fetch the next page and store in cache. */
  function prefetchNextPage(): void {
    if (!settingsStore.prefetchEnabled) return
    if (options.prefetchEnabled?.value === false) return

    const nextOffset = page.value * itemsPerPage.value
    if (nextOffset >= totalCount.value) return // no more pages

    const key = buildPrefetchKey(nextOffset)
    if (prefetchCache.has(key)) return // already pre-fetched

    // Limit cache to 3 entries — evict oldest
    if (prefetchCache.size >= 3) {
      const oldestKey = prefetchCache.keys().next().value
      if (oldestKey !== undefined) prefetchCache.delete(oldestKey)
    }

    const promise = options
      .fetchPage({
        offset: nextOffset,
        limit: itemsPerPage.value,
        sortBy: normalizeSortBy(sortBy.value),
        skipCount: true
      })
      .catch((err) => {
        // Delete failed entry so the normal fetch path runs when this page is requested
        prefetchCache.delete(key)
        throw err
      })

    prefetchCache.set(key, promise)
  }

  // Sync items-per-page to settings store and invalidate prefetch cache
  watch(itemsPerPage, (v) => {
    settingsStore.itemsPerPage = v
    prefetchCache.clear()
  })

  // Clear prefetch cache when filter key changes so stale pre-fetched results
  // are never served after a filter change.
  if (options.filterKey) {
    watch(options.filterKey, () => {
      prefetchCache.clear()
    })
  }

  // ─── Request ordering ─────────────────────────────────────────────────────
  // Several sources can call loadPage concurrently (Vuetify update:options,
  // filter watchers, case switches). Every call gets a monotonically
  // increasing id; only the most recent call may commit results or clear the
  // loading flag (latest-request-wins, same pattern as useShortlistQuery).
  // The transport has no abort support, so stale responses are dropped.
  let latestRequestId = 0
  // An identical request already in flight is joined instead of re-issued.
  let inFlight: { signature: string; promise: Promise<void> } | null = null

  /** Accept only finite, non-negative totals from the backend. */
  const isValidTotal = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0

  const commitTotal = (fromResult: unknown, skipCount: boolean): void => {
    if (!skipCount && isValidTotal(fromResult)) {
      cachedTotalCount = fromResult
      totalCount.value = fromResult
      return
    }
    // Count skipped (or the backend returned garbage): keep the cached value,
    // falling back to the last displayed total — never null/undefined/NaN.
    if (cachedTotalCount !== null) totalCount.value = cachedTotalCount
  }

  async function runRequest(requestId: number, offset: number): Promise<void> {
    const key = buildPrefetchKey(offset)
    const isCurrent = (): boolean => requestId === latestRequestId

    try {
      // Check pre-fetch cache first
      const cached = prefetchCache.get(key)
      if (cached) {
        prefetchCache.delete(key)
        try {
          const result = await cached
          if (!isCurrent()) return
          // A pre-fetched result always used skipCount=true, so keep cached count
          items.value = result.data
          commitTotal(result.total_count, cachedTotalCount !== null)
          error.value = null
          prefetchNextPage()
          return
        } catch (e) {
          logService.warn(
            'Prefetch failed, falling back to normal fetch: ' +
              (e instanceof Error ? e.message : String(e)),
            'pagination'
          )
          if (!isCurrent()) return
        }
      }

      // Skip the COUNT(*) query when we already have a cached total for the
      // current filter set. The cache is invalidated by resetCount().
      const skipCount = cachedTotalCount !== null

      const result = await options.fetchPage({
        offset,
        limit: itemsPerPage.value,
        sortBy: normalizeSortBy(sortBy.value),
        skipCount
      })
      if (!isCurrent()) return

      items.value = result.data
      commitTotal(result.total_count, skipCount)
      error.value = null
      prefetchNextPage()
    } catch (err) {
      if (!isCurrent()) return
      // Keep the previous rows and total visible; surface the error instead.
      error.value = err instanceof Error ? err : new Error(String(err))
    } finally {
      if (isCurrent()) loading.value = false
    }
  }

  /**
   * Load the current page. Use as @update:options handler.
   * Reads page/sortBy/itemsPerPage from reactive refs (set by Vuetify v-model).
   */
  const loadPage = (): Promise<void> => {
    const offset = (page.value - 1) * itemsPerPage.value
    const signature = `${buildPrefetchKey(offset)}|count:${cachedTotalCount === null ? 'need' : 'cached'}`
    if (inFlight !== null && inFlight.signature === signature) {
      return inFlight.promise
    }

    const requestId = ++latestRequestId
    loading.value = true
    const promise = runRequest(requestId, offset).finally(() => {
      if (inFlight?.promise === promise) inFlight = null
    })
    inFlight = { signature, promise }
    return promise
  }

  /**
   * Invalidate the cached total count.
   * Call this whenever filters change so the next loadPage re-queries COUNT(*).
   */
  const resetCount = (): void => {
    cachedTotalCount = null
    inFlight = null
  }

  /**
   * Reset to page 1 and reload.
   * Use when filters change or data needs a full refresh.
   */
  const invalidateAndReload = async (): Promise<void> => {
    prefetchCache.clear()
    resetCount()
    page.value = 1
    await loadPage()
  }

  // Watch sort changes — reset page and clear pre-fetch cache.
  // Computed key avoids deep traversal of sortBy array objects.
  const sortKey = computed(() =>
    normalizeSortBy(sortBy.value)
      .map((s) => `${s.key}:${s.order}`)
      .join(',')
  )
  watch(sortKey, (serialized) => {
    if (serialized === prevSortSerialized) return
    prevSortSerialized = serialized
    prefetchCache.clear()
    page.value = 1
    options.onSortChange?.(sortBy.value.length > 0)
  })

  const resetSort = (): void => {
    sortBy.value = []
  }

  const resetState = (): void => {
    latestRequestId++ // any in-flight response belongs to the previous scope
    inFlight = null
    loading.value = true // show loading immediately to prevent "no data" flash
    items.value = []
    totalCount.value = 0
    error.value = null
    page.value = 1
    sortBy.value = []
    prevSortSerialized = ''
    cachedTotalCount = null
    prefetchCache.clear()
  }

  return {
    // Table state (v-model bindings for v-data-table-server)
    page,
    itemsPerPage,
    sortBy,
    itemsPerPageOptions,

    // Result state
    items,
    totalCount,
    loading,
    error,

    // Methods
    loadPage,
    invalidateAndReload,
    resetCount,
    resetSort,
    resetState
  }
}
