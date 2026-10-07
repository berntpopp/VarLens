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
import { formatError } from '../utils/ipc-result'
import { createPageCache, runWhenIdle } from './pageCache'
import type { ViewRoute } from './useUrlState'
import { useSortUrlParam } from './useViewUrlBindings'

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
  /** Mirror sort keys into the URL query (`?sort=`) for this view. */
  urlSortRoute?: ViewRoute
}

export function useOffsetPagination<T>(options: UseOffsetPaginationOptions<T>) {
  const settingsStore = useSettingsStore()

  // Table state — bind to v-data-table-server via v-model
  const page = ref(1)
  const itemsPerPage = ref(settingsStore.itemsPerPage)
  const sortBy = ref<SortItem[]>([])
  if (options.urlSortRoute !== undefined) useSortUrlParam(options.urlSortRoute, sortBy)
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

  // Page cache (LRU, reads do not evict): fetched and prefetched pages keyed
  // by offset + page size + sort + filter key, so prev/next/back navigation
  // within one filter set is served without a round trip. Cleared on any
  // filter, sort or page-size change and on invalidateAndReload().
  const pageCache = createPageCache<Promise<OffsetPageResult<T>>>(8)

  function buildPrefetchKey(offset: number): string {
    const sortKey = JSON.stringify(normalizeSortBy(sortBy.value))
    const fKey = options.filterKey?.value ?? ''
    return `${offset}:${itemsPerPage.value}:${sortKey}:${fKey}`
  }

  const prefetchAllowed = (): boolean =>
    settingsStore.prefetchEnabled && options.prefetchEnabled?.value !== false

  /** Fire-and-forget: fetch one page (without COUNT) into the cache. */
  function prefetchPage(offset: number): void {
    if (offset < 0 || offset >= totalCount.value) return
    const key = buildPrefetchKey(offset)
    if (pageCache.has(key)) return
    const promise = options
      .fetchPage({
        offset,
        limit: itemsPerPage.value,
        sortBy: normalizeSortBy(sortBy.value),
        skipCount: true
      })
      .catch((err) => {
        // Drop failed entries so the normal fetch path runs when requested
        pageCache.delete(key)
        throw err
      })
    pageCache.set(key, promise)
  }

  /** After a page settles, warm the next and previous pages when idle. */
  function prefetchAdjacentPages(): void {
    if (!prefetchAllowed()) return
    runWhenIdle(() => {
      if (!prefetchAllowed() || loading.value) return
      const offset = (page.value - 1) * itemsPerPage.value
      prefetchPage(offset + itemsPerPage.value)
      prefetchPage(offset - itemsPerPage.value)
    })
  }

  // Sync items-per-page to settings store and invalidate prefetch cache
  watch(itemsPerPage, (v) => {
    settingsStore.itemsPerPage = v
    pageCache.clear()
  })

  // Clear prefetch cache when filter key changes so stale pre-fetched results
  // are never served after a filter change.
  if (options.filterKey) {
    watch(options.filterKey, () => {
      pageCache.clear()
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
  // Filter key of the most recently issued request (see reloadIfFiltersChanged).
  let lastIssuedFilterKey: string | undefined

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
      // Serve from the page cache first (kept for later revisits)
      const cached = pageCache.get(key)
      if (cached) {
        try {
          const result = await cached
          if (!isCurrent()) return
          // Cached pages may lack a count, so keep the cached total
          items.value = result.data
          commitTotal(result.total_count, cachedTotalCount !== null)
          error.value = null
          prefetchAdjacentPages()
          return
        } catch (e) {
          logService.warn(
            'Prefetch failed, falling back to normal fetch: ' + formatError(e, 'unknown error'),
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
      pageCache.set(key, Promise.resolve(result))
      prefetchAdjacentPages()
    } catch (err) {
      if (!isCurrent()) return
      // Keep the previous rows and total visible; surface the error instead.
      // unwrapIpcResult throws a plain SerializableError, so String(err)
      // would surface "[object Object]" in the table's error banner.
      error.value = err instanceof Error ? err : new Error(formatError(err, 'Failed to load data.'))
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
    lastIssuedFilterKey = options.filterKey?.value
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
  }

  /**
   * Reset to page 1 and reload.
   * Use when filters change or data needs a full refresh.
   */
  const invalidateAndReload = async (): Promise<void> => {
    pageCache.clear()
    resetCount()
    page.value = 1
    await loadPage()
  }

  /**
   * Refetch the page the user is on after the underlying data changed (for
   * example a case was imported). Keeps the page number, and the rows stay on
   * screen until the fresh ones arrive.
   */
  const reloadCurrentPage = async (): Promise<void> => {
    pageCache.clear()
    resetCount()
    await loadPage()
  }

  /**
   * Reload only when the filter key differs from the last issued request.
   * Lets several filter-change sources (Clear, debounced chips, column
   * filters) converge on one query. Without a filterKey it always reloads.
   */
  const reloadIfFiltersChanged = async (): Promise<void> => {
    if (options.filterKey !== undefined && options.filterKey.value === lastIssuedFilterKey) return
    await invalidateAndReload()
  }

  // Watch sort changes — reset page and clear the page cache.
  // Computed key avoids deep traversal of sortBy array objects.
  const sortKey = computed(() =>
    normalizeSortBy(sortBy.value)
      .map((s) => `${s.key}:${s.order}`)
      .join(',')
  )
  watch(sortKey, (serialized) => {
    if (serialized === prevSortSerialized) return
    prevSortSerialized = serialized
    pageCache.clear()
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
    pageCache.clear()
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
    reloadCurrentPage,
    reloadIfFiltersChanged,
    resetCount,
    resetSort,
    resetState
  }
}
