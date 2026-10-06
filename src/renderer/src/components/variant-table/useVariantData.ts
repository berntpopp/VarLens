import { ref, shallowRef, computed, watch, markRaw, toRaw, type Ref } from 'vue'
import type { Variant, VariantFilter } from '../../../../shared/types/api'
import type { ColumnFilterMeta } from '../../../../shared/types/column-filters'
import { useOffsetPagination } from '../../composables/useOffsetPagination'
import { useAnnotations } from '../../composables/useAnnotations'
import { logService } from '../../services/LogService'
import { useColumnFilters } from '../../composables/useColumnFilters'
import { useDebounce } from '../../composables/useDebounce'
import { useDeferredReload } from '../../composables/useDeferredReload'
import { useApiService } from '../../composables/useApiService'
import { stripVueProxies } from '../../utils/stripVueProxies'
import { traceStart, traceEnd } from '../../services/PerfTrace'
import type { PerfBudgetKey } from '../../../../shared/config/perf-budgets'
import { unwrapIpcResult } from '../../../../shared/types/errors'

interface UseVariantDataOptions {
  caseId: Ref<number>
  filters: Ref<Omit<VariantFilter, 'case_id'>>
  active?: Ref<boolean>
  /** Optional external column metadata (e.g. from useFilterState). Avoids duplicate IPC call. */
  columnMeta?: Ref<ColumnFilterMeta[]>
  onCountsUpdate: (counts: { filtered: number; total: number }) => void
  onSortUpdate: (hasSort: boolean) => void
}

export function useVariantData(options: UseVariantDataOptions) {
  const {
    caseId,
    filters,
    active = ref(true),
    columnMeta: externalColumnMeta,
    onCountsUpdate,
    onSortUpdate
  } = options
  const { api } = useApiService()

  // Flow-level tracing: track active user-flow trace across watchers
  let activeFlowTraceId: string | null = null
  let activeFlowBudget: PerfBudgetKey | undefined = undefined

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
    urlSortRoute: 'case',
    fetchPage: async ({ offset, limit, sortBy: sortItems, skipCount }) => {
      if (!api) {
        logService.warn('API not available - running outside Electron', 'variants')
        return { data: [], total_count: 0 }
      }

      // Deep-clone to strip Vue reactive proxies for IPC serialization
      const colFilters = getColumnFiltersParam()
      const rawFilters = filters.value
      const plainFilters = stripVueProxies({
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
      const result = unwrapIpcResult(
        await api.variants.query(
          caseId.value,
          plainFilters,
          offset,
          limit,
          sortItems,
          skipCount,
          shouldFetchUnfiltered
        )
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
    filterKey,
    prefetchEnabled: active
  })

  // Use external columnMeta if provided (from useFilterState), otherwise internal ref
  const columnMeta = externalColumnMeta ?? shallowRef<ColumnFilterMeta[]>([])

  // Row props for zebra striping and selection highlighting
  const getRowProps = ({ item, index }: { item: Variant; index: number }) => {
    let className = ''
    if (index % 2 === 1) className = 'variant-row--striped'
    const selected = item.id === selectedVariantId.value
    if (selected) {
      className = className ? className + ' variant-row--selected' : 'variant-row--selected'
    }
    // a11y: expose the selected row and make it the focus-return target
    return selected
      ? { class: className, 'aria-current': 'true', tabindex: 0 }
      : { class: className }
  }

  // Update counts when variants load. Watch both totals: a case switch can land
  // on the same filtered total while the unfiltered total changes.
  watch([totalCount, unfilteredCount], ([filtered, total]) => {
    onCountsUpdate({ filtered, total })
  })

  // Work requested while hidden (KeepAlive / Shortlist tab) is replayed on show (P0-3).
  const { requestReload, markPending, isPending } = useDeferredReload(active, invalidateAndReload)

  // Reset state on case change; unfiltered count is fetched with the first page load
  watch(
    caseId,
    (newCaseId, oldCaseId) => {
      selectedVariantId.value = null
      clearAllColumnFilters()

      if (newCaseId !== undefined && newCaseId !== 0) {
        if (import.meta.env.DEV) {
          if (activeFlowTraceId !== null) {
            traceEnd(activeFlowTraceId, activeFlowBudget)
          }
          activeFlowTraceId = traceStart('case-switch')
          activeFlowBudget = 'CASE_SWITCH'
        }
        resetState()
        clearAnnotationCache()
        needsUnfilteredCount = true
        // The initial mount is loaded by Vuetify's first update:options; any
        // later case switch must issue its own query (now or when visible).
        if (oldCaseId !== undefined) void requestReload()
      }
    },
    { immediate: true }
  )

  // Reload when filters change (serialized key avoids deep reactive traversal)
  watch(filterKey, () => {
    if (!active.value) {
      markPending()
      return
    }
    if (import.meta.env.DEV) {
      if (activeFlowTraceId !== null) {
        traceEnd(activeFlowTraceId, activeFlowBudget)
      }
      activeFlowTraceId = traceStart('filter-apply')
      activeFlowBudget = 'FILTER_APPLY'
    }
    invalidateAndReload()
  })

  // Debounced reload when per-column filters change
  const { debouncedFn: debouncedColumnFilterReload } = useDebounce(invalidateAndReload, 300)
  watch(columnFilterState.columnFilters, () => {
    if (!active.value) {
      markPending()
      return
    }
    debouncedColumnFilterReload()
  })

  // Load annotations when variants change; invalidate generation first so any
  // in-flight batch from the previous page is discarded when it resolves.
  watch(
    variants,
    async (newVariants) => {
      invalidateAnnotationGeneration()
      if (!active.value) return
      if (newVariants.length > 0 && caseId.value !== undefined && caseId.value !== 0) {
        await loadAnnotationsBatch(caseId.value, newVariants)
      }
      // Flow complete: data fetched + annotations hydrated
      if (import.meta.env.DEV && activeFlowTraceId !== null) {
        traceEnd(activeFlowTraceId, activeFlowBudget)
        activeFlowTraceId = null
      }
    },
    { immediate: true }
  )

  watch(
    active,
    async (isActive) => {
      // A pending reload replaces the rows; the variants watcher hydrates those.
      if (!isActive || isPending()) return
      if (variants.value.length === 0 || caseId.value === undefined || caseId.value === 0) return
      invalidateAnnotationGeneration()
      await loadAnnotationsBatch(caseId.value, variants.value)
    },
    { immediate: false }
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
