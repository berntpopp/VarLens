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

  /**
   * Load the current page. Use as @update:options handler.
   * Reads page/sortBy/itemsPerPage from reactive refs (set by Vuetify v-model).
   */
  const loadPage = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const offset = (page.value - 1) * itemsPerPage.value
      const key = buildPrefetchKey(offset)

      // Check pre-fetch cache first
      const cached = prefetchCache.get(key)
      if (cached) {
        prefetchCache.delete(key)
        try {
          const result = await cached

          // A pre-fetched result always used skipCount=true, so keep cached count
          items.value = result.data
          totalCount.value = cachedTotalCount ?? result.total_count

          prefetchNextPage()
          return
        } catch (e) {
          logService.warn(
            'Prefetch failed, falling back to normal fetch: ' +
              (e instanceof Error ? e.message : String(e)),
            'pagination'
          )
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

      items.value = result.data

      if (skipCount) {
        // Keep the cached count; the backend may return 0 or a stale value
        // when skipCount is true — we use the cached value instead.
        totalCount.value = cachedTotalCount!
      } else {
        totalCount.value = result.total_count
        cachedTotalCount = result.total_count
      }

      prefetchNextPage()
    } catch (err) {
      error.value = err instanceof Error ? err : new Error(String(err))
      items.value = []
      totalCount.value = 0
    } finally {
      loading.value = false
    }
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
