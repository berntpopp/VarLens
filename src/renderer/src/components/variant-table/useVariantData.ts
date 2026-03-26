import { ref, shallowRef, computed, watch, markRaw, toRaw, type Ref } from 'vue'
import type { Variant, VariantFilter } from '../../../../shared/types/api'
import type { ColumnFilterMeta } from '../../../../shared/types/column-filters'
import { useOffsetPagination } from '../../composables/useOffsetPagination'
import { useAnnotations } from '../../composables/useAnnotations'
import { useColumnFilters } from '../../composables/useColumnFilters'
import { useDebounce } from '../../composables/useDebounce'
import { useApiService } from '../../composables/useApiService'

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
    clearCache: clearAnnotationCache,
    ...annotationMethods
  } = useAnnotations()

  // Column filters
  const columnFilterState = useColumnFilters()
  const { getColumnFiltersParam, clearAllColumnFilters } = columnFilterState

  // Serialized filter key — used to scope the prefetch cache so stale results
  // from a previous filter set are never served after a filter change.
  const filterKey = computed(() => JSON.stringify(toRaw(filters.value)))

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
        console.warn('API not available - running outside Electron')
        return { data: [], total_count: 0 }
      }

      // Strip reactive proxies for IPC via structuredClone (faster than JSON round-trip)
      const colFilters = getColumnFiltersParam()
      const rawFilters = filters.value
      const plainFilters = structuredClone({
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).variants.query(
        caseId.value,
        plainFilters,
        offset,
        limit,
        sortItems,
        skipCount
      )

      return {
        data: markRaw(result.data),
        total_count: result.total_count
      }
    },
    onSortChange: onSortUpdate,
    filterKey
  })

  // Domain-specific state
  const unfilteredCount = ref(0)
  const selectedVariantId = ref<number | null>(null)
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

  // Fetch unfiltered count on case change
  watch(
    caseId,
    async (newCaseId) => {
      selectedVariantId.value = null
      clearAllColumnFilters()

      if (newCaseId !== undefined && newCaseId !== 0) {
        resetState()
        clearAnnotationCache()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (api as any).variants.query(newCaseId, {}, undefined, 1, [])
        unfilteredCount.value = result.total_count
      }
    },
    { immediate: true }
  )

  // Reload when filters change (serialized key avoids deep reactive traversal)
  watch(filterKey, invalidateAndReload)

  // Debounced reload when per-column filters change
  const { debouncedFn: debouncedColumnFilterReload } = useDebounce(invalidateAndReload, 300)
  watch(columnFilterState.columnFilters, debouncedColumnFilterReload)

  // Load annotations when variants change
  watch(
    variants,
    async (newVariants) => {
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
