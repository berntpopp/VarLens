import { ref, watch, type Ref } from 'vue'
import type {
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem
} from '../../../../shared/types/api'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAnnotations } from '../../composables/useAnnotations'
import { useColumnFilters } from '../../composables/useColumnFilters'
import { useDebounce } from '../../composables/useDebounce'
import { APP_CONFIG } from '../../../../shared/config'
import { useApiService } from '../../composables/useApiService'

interface UseVariantDataOptions {
  caseId: Ref<number>
  filters: Ref<Omit<VariantFilter, 'case_id'>>
  onCountsUpdate: (counts: { filtered: number; total: number }) => void
  onSortUpdate: (hasSort: boolean) => void
}

export function useVariantData(options: UseVariantDataOptions) {
  const { caseId, filters, onCountsUpdate, onSortUpdate } = options
  const { api } = useApiService()
  const settingsStore = useSettingsStore()

  const itemsPerPageOptions = [...APP_CONFIG.ITEMS_PER_PAGE_OPTIONS]

  // Annotations
  const {
    loadAnnotationsBatch,
    clearCache: clearAnnotationCache,
    ...annotationMethods
  } = useAnnotations()

  // Column filters
  const columnFilterState = useColumnFilters()
  const { getColumnFiltersParam, clearAllColumnFilters } = columnFilterState

  // Table state
  const variants = ref<Variant[]>([])
  const totalCount = ref(0)
  const loading = ref(false)
  const page = ref(1)
  const itemsPerPage = ref(settingsStore.itemsPerPage)
  const sortBy = ref<SortItem[]>([])
  const cursorCache = ref<Map<string, PaginationCursor>>(new Map())
  const unfilteredCount = ref(0)
  const selectedVariantId = ref<number | null>(null)

  // Sync items-per-page changes back to settings store
  watch(itemsPerPage, (v) => {
    settingsStore.itemsPerPage = v
  })

  // Row props for zebra striping and selection highlighting
  const getRowProps = ({ item, index }: { item: Variant; index: number }) => {
    const classes: string[] = []
    if (index % 2 === 1) classes.push('variant-row--striped')
    if (item.id === selectedVariantId.value) classes.push('variant-row--selected')
    return { class: classes.join(' ') }
  }

  // Load variants from backend
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadVariants = async (_options?: any): Promise<void> => {
    if (!api) {
      console.warn('API not available - running outside Electron')
      return
    }

    loading.value = true
    try {
      const sortKey = sortBy.value.length > 0 ? sortBy.value[0].key : 'default'
      const sortOrder = sortBy.value.length > 0 ? sortBy.value[0].order : 'asc'
      const cacheKey = `${page.value}-${sortKey}-${sortOrder}`
      const cursor = page.value === 1 ? undefined : cursorCache.value.get(cacheKey)

      // Deep-clone to strip reactive proxies
      const plainFilters = JSON.parse(JSON.stringify(filters.value))
      const colFilters = getColumnFiltersParam()
      if (colFilters !== undefined) {
        plainFilters.column_filters = colFilters
      }
      const plainSortBy = JSON.parse(JSON.stringify(sortBy.value))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: PaginatedResult<Variant> = await (api as any).variants.query(
        caseId.value,
        plainFilters,
        cursor,
        itemsPerPage.value,
        plainSortBy
      )

      variants.value = result.data
      totalCount.value = result.total_count

      onCountsUpdate({
        filtered: result.total_count,
        total: unfilteredCount.value
      })

      if ((result.next_cursor ?? null) !== null && result.has_more) {
        const nextCacheKey = `${page.value + 1}-${sortKey}-${sortOrder}`
        cursorCache.value.set(nextCacheKey, result.next_cursor!)
      }
    } catch (error) {
      console.error('Failed to load variants:', error)
      variants.value = []
      totalCount.value = 0
    } finally {
      loading.value = false
    }
  }

  // Fetch unfiltered count on case change
  watch(
    caseId,
    async (newCaseId) => {
      selectedVariantId.value = null
      clearAllColumnFilters()

      if (newCaseId !== undefined && newCaseId !== 0) {
        cursorCache.value.clear()
        page.value = 1
        clearAnnotationCache()

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (api as any).variants.query(newCaseId, {}, undefined, 1, [])
        unfilteredCount.value = result.total_count
      }
    },
    { immediate: true }
  )

  // Clear cache when sort changes
  watch(
    sortBy,
    () => {
      cursorCache.value.clear()
      page.value = 1
      onSortUpdate(sortBy.value.length > 0)
    },
    { deep: true }
  )

  // Reload when filters change
  watch(
    filters,
    async () => {
      cursorCache.value.clear()
      page.value = 1
      await loadVariants()
    },
    { deep: true }
  )

  // Debounced reload when per-column filters change
  const { debouncedFn: debouncedColumnFilterReload } = useDebounce(async () => {
    cursorCache.value.clear()
    page.value = 1
    await loadVariants()
  }, 300)
  watch(getColumnFiltersParam, debouncedColumnFilterReload, { deep: true })

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

  const resetSort = () => {
    sortBy.value = []
  }

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
