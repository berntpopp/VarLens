/**
 * Shared composable for offset-based pagination with v-data-table-server.
 *
 * Replaces cursor-based pagination. Uses simple OFFSET = (page - 1) * limit.
 * Maps directly to Vuetify's page-number model — no cursor cache or gap-filling.
 *
 * DRY: Both case (VariantTable) and cohort (CohortTable) views use this composable.
 */

import { ref, shallowRef, watch, type Ref } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'
import { APP_CONFIG } from '../../../shared/config'

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
  const loading = ref(false)
  const error = ref<Error | null>(null)

  // Sort change detection (prevents spurious reloads on reference changes)
  let prevSortSerialized = ''

  // Count cache — avoids redundant COUNT(*) queries on page navigation.
  // Invalidated via resetCount() when filters change.
  let cachedTotalCount: number | null = null

  // Sync items-per-page to settings store
  watch(itemsPerPage, (v) => {
    settingsStore.itemsPerPage = v
  })

  /**
   * Load the current page. Use as @update:options handler.
   * Reads page/sortBy/itemsPerPage from reactive refs (set by Vuetify v-model).
   */
  const loadPage = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const offset = (page.value - 1) * itemsPerPage.value
      const plainSortBy = normalizeSortBy(sortBy.value)

      // Skip the COUNT(*) query when we already have a cached total for the
      // current filter set. The cache is invalidated by resetCount().
      const skipCount = cachedTotalCount !== null

      const result = await options.fetchPage({
        offset,
        limit: itemsPerPage.value,
        sortBy: plainSortBy,
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
    resetCount()
    page.value = 1
    await loadPage()
  }

  // Watch sort changes — reset page.
  // The page reset triggers Vuetify to re-emit @update:options → loadPage.
  watch(
    sortBy,
    () => {
      const serialized = normalizeSortBy(sortBy.value)
        .map((s) => `${s.key}:${s.order}`)
        .join(',')
      if (serialized === prevSortSerialized) return
      prevSortSerialized = serialized
      page.value = 1
      options.onSortChange?.(sortBy.value.length > 0)
    },
    { deep: true }
  )

  const resetSort = (): void => {
    sortBy.value = []
  }

  const resetState = (): void => {
    items.value = []
    totalCount.value = 0
    error.value = null
    page.value = 1
    sortBy.value = []
    prevSortSerialized = ''
    cachedTotalCount = null
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
