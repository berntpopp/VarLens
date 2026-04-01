import { ref, shallowRef, computed, watch, markRaw, toRaw, type Ref } from 'vue'
import type { Variant, VariantFilter } from '../../../../shared/types/api'
import type { ColumnFilterMeta } from '../../../../shared/types/column-filters'
import { useOffsetPagination } from '../../composables/useOffsetPagination'
import { useAnnotations } from '../../composables/useAnnotations'
import { logService } from '../../services/LogService'
import { useColumnFilters } from '../../composables/useColumnFilters'
import { useDebounce } from '../../composables/useDebounce'
import { useApiService } from '../../composables/useApiService'
import { cloneForIpc } from '../../utils/cloneForIpc'

interface UseVariantDataOptions {
  caseId: Ref<number>
  filters: Ref<Omit<VariantFilter, 'case_id'>>
  /** Optional external column metadata (e.g. from useFilterState). Avoids duplicate IPC call. */
  columnMeta?: Ref<ColumnFilterMeta[]>
  onCountsUpdate: (counts: { filtered: number; total: number }) => void
  onSortUpdate: (hasSort: boolean) => void
}

export function useVariantData(options: UseVariantDataOptions) {
  const { caseId, filters, columnMeta: externalColumnMeta, onCountsUpdate, onSortUpdate } = options
  const { api } = useApiService()

  // Annotations
  const {
    loadAnnotationsBatch,
    invalidateAnnotationGeneration,
    clearCache: clearAnnotationCache,
    ...annotationMethods
  } = useAnnotations()

  // Column filters
  const columnFilterState = useColumnFilters()
  const { getColumnFiltersParam, clearAllColumnFilters } = columnFilterState

  // Serialized filter key — used to scope the prefetch cache so stale results
  // from a previous filter set are never served after a filter change.
  const filterKey = computed(() => JSON.stringify(toRaw(filters.value)))

  // Domain-specific state (declared before useOffsetPagination so fetchPage closure can capture them)
  const unfilteredCount = ref(0)
  const selectedVariantId = ref<number | null>(null)
  // Flag: request unfiltered count to be piggybacked on the next page load
  let needsUnfilteredCount = true

  // Shared offset pagination
  const {
    page,
    itemsPerPage,
    sortBy,
    itemsPerPageOptions,
    items: variants,
    totalCount,
    loading,
    loadPage: loadVariants,
    invalidateAndReload,
    resetSort,
    resetState
  } = useOffsetPagination<Variant>({
    fetchPage: async ({ offset, limit, sortBy: sortItems, skipCount }) => {
      if (!api) {
        logService.warn('API not available - running outside Electron', 'variants')
        return { data: [], total_count: 0 }
      }

      // Deep-clone to strip Vue reactive proxies for IPC serialization
      const colFilters = getColumnFiltersParam()
      const rawFilters = filters.value
      const plainFilters = cloneForIpc({
        ...rawFilters,
        ...(colFilters !== undefined || rawFilters.column_filters !== undefined
          ? {
              // Merge: header filters first, DSL filters override for same column
              column_filters: {
                ...(colFilters ?? {}),
                ...(rawFilters.column_filters ?? {})
              }
            }
          : {})
      })
      const shouldFetchUnfiltered = needsUnfilteredCount
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).variants.query(
        caseId.value,
        plainFilters,
        offset,
        limit,
        sortItems,
        skipCount,
        shouldFetchUnfiltered
      )

      if (shouldFetchUnfiltered && result.unfiltered_count !== undefined) {
        unfilteredCount.value = result.unfiltered_count
        needsUnfilteredCount = false
      }

      return {
        data: markRaw(result.data),
        total_count: result.total_count
      }
    },
    onSortChange: onSortUpdate,
    filterKey
  })

  // Use external columnMeta if provided (from useFilterState), otherwise internal ref
  const columnMeta = externalColumnMeta ?? shallowRef<ColumnFilterMeta[]>([])

  // Row props for zebra striping and selection highlighting
  const getRowProps = ({ item, index }: { item: Variant; index: number }) => {
    let className = ''
    if (index % 2 === 1) className = 'variant-row--striped'
    if (item.id === selectedVariantId.value) {
      className = className ? className + ' variant-row--selected' : 'variant-row--selected'
    }
    return { class: className }
  }

  // Update counts when variants load
  watch(totalCount, (filtered) => {
    onCountsUpdate({ filtered, total: unfilteredCount.value })
  })

  // Reset state on case change; unfiltered count is fetched with the first page load
  watch(
    caseId,
    (newCaseId) => {
      selectedVariantId.value = null
      clearAllColumnFilters()

      if (newCaseId !== undefined && newCaseId !== 0) {
        resetState()
        clearAnnotationCache()
        needsUnfilteredCount = true
        // The first loadPage triggered by resetState will include the unfiltered count
      }
    },
    { immediate: true }
  )

  // Reload when filters change (serialized key avoids deep reactive traversal)
  watch(filterKey, invalidateAndReload)

  // Debounced reload when per-column filters change
  const { debouncedFn: debouncedColumnFilterReload } = useDebounce(invalidateAndReload, 300)
  watch(columnFilterState.columnFilters, debouncedColumnFilterReload)

  // Load annotations when variants change; invalidate generation first so any
  // in-flight batch from the previous page is discarded when it resolves.
  watch(
    variants,
    async (newVariants) => {
      invalidateAnnotationGeneration()
      if (newVariants.length > 0 && caseId.value !== undefined && caseId.value !== 0) {
        await loadAnnotationsBatch(caseId.value, newVariants)
      }
    },
    { immediate: true }
  )

  return {
    // Table state
    variants,
    totalCount,
    loading,
    page,
    itemsPerPage,
    sortBy,
    itemsPerPageOptions,
    selectedVariantId,
    columnMeta,

    // Methods
    loadVariants,
    resetSort,
    getRowProps,

    // Column filters (pass through)
    ...columnFilterState,

    // Annotations (pass through)
    ...annotationMethods,
    loadAnnotationsBatch,
    clearAnnotationCache
  }
}
