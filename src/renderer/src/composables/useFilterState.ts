/**
 * Composable for variant filter state management
 *
 * Extracts filter state, presets, computed properties, filter manipulation,
 * emission logic, gene autocomplete, export, and case-switching from
 * FilterToolbar.vue into a reusable composable.
 *
 * This composable is the single source of truth for variant filter state.
 * Both FilterToolbar (compact bar) and a future FilterPanel (drawer) can
 * share this composable to keep filter state in sync.
 *
 * Provides:
 * - Core filter state (search, gene, consequences, funcs, clinvars, numeric, tags)
 * - Preset selections with bidirectional sync (via useFilterPresets)
 * - Active filter tracking (count, list, per-group check)
 * - Filter manipulation (clear, remove tag, clear all)
 * - Gene autocomplete with debounced IPC
 * - Filter emission with debounce
 * - Case-switch reset and filter options reload
 * - Excel export (via useFilterExport)
 */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { useDebounce } from './useDebounce'
import { useTags } from './useTags'
import { useApiService } from './useApiService'
import type { FilterOptions } from '../../../shared/types/api'
import { APP_CONFIG } from '../../../shared/config'
import {
  buildFilterFromState,
  type FilterState,
  type ActiveFilter,
  type UseFilterStateOptions,
  type UseFilterStateReturn
} from './filter-types'
import { useFilterPresets } from './useFilterPresets'
import { useFilterExport } from './useFilterExport'

// Re-export types so existing consumers (e.g. filterDrawerTypes.ts) continue to work
export type { FilterState, ActiveFilter, ExportResult, UseFilterStateReturn } from './filter-types'

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Composable for variant filter state management
 *
 * @param caseIdRef - Reactive ref to the current case ID
 * @param options - Callbacks and configuration options
 * @returns Filter state, computed properties, and manipulation methods
 */
export function useFilterState(
  caseIdRef: Ref<number> | ComputedRef<number>,
  options: UseFilterStateOptions
): UseFilterStateReturn {
  const { onFiltersUpdate, onResetSort } = options

  // API service
  const { api } = useApiService()

  // Tags composable
  const { loadTags, getTags } = useTags()

  // -------------------------------------------------------------------------
  // Filter state
  // -------------------------------------------------------------------------

  const filters = ref<FilterState>({
    searchQuery: '',
    geneSymbol: '',
    consequences: [] as string[],
    funcs: [] as string[],
    clinvars: [] as string[],
    maxGnomadAf: null as number | null,
    minCadd: null as number | null,
    tagIds: [] as number[],
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [] as string[],
    annotationScope: 'case' as const
  })

  // Filter options loaded from database
  const filterOptions = ref<FilterOptions>({
    consequences: [] as string[],
    funcs: [] as string[],
    clinvars: [] as string[],
    minCadd: null as number | null,
    maxCadd: null as number | null,
    minGnomadAf: null as number | null,
    maxGnomadAf: null as number | null,
    columnMeta: []
  })

  // Gene autocomplete state
  const geneSymbolSuggestions = ref<string[]>([])
  const loadingSuggestions = ref(false)

  // Export state
  const exporting = ref(false)

  // -------------------------------------------------------------------------
  // Presets (delegated to useFilterPresets)
  // -------------------------------------------------------------------------

  // useFilterPresets sets up watchers internally; the `() => debouncedEmit()`
  // callback is a closure that captures `debouncedEmit` at call time (not
  // definition time), so it works even though debouncedEmit is defined below.
  const {
    selectedImpactPresets,
    selectedAfPreset,
    selectedCaddPreset,
    afPresets,
    caddPresets,
    impactPresets,
    resetPresets
  } = useFilterPresets(filters, () => debouncedEmit())

  // -------------------------------------------------------------------------
  // Filter emission
  // -------------------------------------------------------------------------

  /**
   * Build VariantFilter from current state and invoke the callback
   */
  const emitFilters = () => {
    const variantFilter = buildFilterFromState(filters.value, selectedImpactPresets.value)
    onFiltersUpdate(variantFilter)
  }

  // Create debounced version
  const { debouncedFn: debouncedEmit } = useDebounce(emitFilters, APP_CONFIG.DEBOUNCE_MS)

  // -------------------------------------------------------------------------
  // Export (delegated to useFilterExport)
  // -------------------------------------------------------------------------

  const { exportToExcel } = useFilterExport(filters, selectedImpactPresets, exporting)

  // Available tags for filter
  const availableTags = computed(() => getTags())

  // -------------------------------------------------------------------------
  // Computed properties
  // -------------------------------------------------------------------------

  const hasActiveFilters = computed(() => {
    const afActive =
      filters.value.maxGnomadAf !== null &&
      Number.isNaN(filters.value.maxGnomadAf) === false &&
      filters.value.maxGnomadAf > 0
    const caddActive =
      filters.value.minCadd !== null &&
      Number.isNaN(filters.value.minCadd) === false &&
      filters.value.minCadd >= 0

    return (
      filters.value.searchQuery !== '' ||
      (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') ||
      selectedImpactPresets.value.length > 0 ||
      filters.value.consequences.length > 0 ||
      filters.value.funcs.length > 0 ||
      filters.value.clinvars.length > 0 ||
      afActive ||
      caddActive ||
      filters.value.tagIds.length > 0 ||
      filters.value.starredOnly ||
      filters.value.hasCommentOnly ||
      filters.value.acmgClassifications.length > 0
    )
  })

  const activeFilterCount = computed(() => {
    let count = 0
    if (filters.value.searchQuery !== '') count++
    if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') count++
    if (selectedImpactPresets.value.length > 0) count++
    if (filters.value.consequences.length > 0) count++
    if (filters.value.funcs.length > 0) count++
    if (filters.value.clinvars.length > 0) count++
    if (
      filters.value.maxGnomadAf !== null &&
      !Number.isNaN(filters.value.maxGnomadAf) &&
      filters.value.maxGnomadAf > 0
    )
      count++
    if (
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    )
      count++
    if (filters.value.tagIds.length > 0) count++
    if (filters.value.starredOnly) count++
    if (filters.value.hasCommentOnly) count++
    if (filters.value.acmgClassifications.length > 0) count++
    return count
  })

  const activeFiltersList = computed<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = []

    if (filters.value.searchQuery !== '') {
      list.push({ id: 'search', label: 'Search', value: filters.value.searchQuery })
    }
    if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') {
      list.push({ id: 'gene', label: 'Gene', value: filters.value.geneSymbol })
    }
    if (selectedImpactPresets.value.length > 0) {
      list.push({ id: 'impact', label: 'Impact', value: selectedImpactPresets.value.join(', ') })
    }
    if (filters.value.consequences.length > 0) {
      list.push({
        id: 'consequences',
        label: 'Consequences',
        value: `${filters.value.consequences.length} selected`
      })
    }
    if (filters.value.funcs.length > 0) {
      list.push({
        id: 'funcs',
        label: 'Consequence',
        value: `${filters.value.funcs.length} selected`
      })
    }
    if (filters.value.clinvars.length > 0) {
      list.push({
        id: 'clinvars',
        label: 'ClinVar',
        value: `${filters.value.clinvars.length} selected`
      })
    }
    if (
      filters.value.maxGnomadAf !== null &&
      !Number.isNaN(filters.value.maxGnomadAf) &&
      filters.value.maxGnomadAf > 0
    ) {
      const pct = (filters.value.maxGnomadAf * 100).toFixed(2)
      list.push({ id: 'frequency', label: 'AF \u2264', value: `${pct}%` })
    }
    if (
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    ) {
      list.push({ id: 'cadd', label: 'CADD \u2265', value: String(filters.value.minCadd) })
    }
    if (filters.value.tagIds.length > 0) {
      const tagNames = availableTags.value
        .filter((t) => filters.value.tagIds.includes(t.id))
        .map((t) => t.name)
      list.push({ id: 'tags', label: 'Tags', value: tagNames.join(', ') })
    }
    if (filters.value.starredOnly) {
      list.push({ id: 'starred', label: 'Starred', value: 'only' })
    }
    if (filters.value.hasCommentOnly) {
      list.push({ id: 'commented', label: 'Commented', value: 'only' })
    }
    if (filters.value.acmgClassifications.length > 0) {
      list.push({
        id: 'acmg',
        label: 'ACMG',
        value: filters.value.acmgClassifications.join(', ')
      })
    }
    if (filters.value.annotationScope === 'all') {
      list.push({ id: 'annotationScope', label: 'Scope', value: 'All (global)' })
    }

    return list
  })

  // -------------------------------------------------------------------------
  // Filter group active check
  // -------------------------------------------------------------------------

  const isFilterGroupActive = (groupId: string): boolean => {
    switch (groupId) {
      case 'search':
        return filters.value.searchQuery !== ''
      case 'gene':
        return filters.value.geneSymbol != null && filters.value.geneSymbol !== ''
      case 'impact':
        return selectedImpactPresets.value.length > 0 || filters.value.consequences.length > 0
      case 'function':
        return filters.value.funcs.length > 0
      case 'clinvar':
        return filters.value.clinvars.length > 0
      case 'frequency':
        return (
          filters.value.maxGnomadAf !== null &&
          !Number.isNaN(filters.value.maxGnomadAf) &&
          filters.value.maxGnomadAf > 0
        )
      case 'cadd':
        return (
          filters.value.minCadd !== null &&
          !Number.isNaN(filters.value.minCadd) &&
          filters.value.minCadd >= 0
        )
      case 'tags':
        return filters.value.tagIds.length > 0
      case 'annotations':
        return (
          filters.value.starredOnly ||
          filters.value.hasCommentOnly ||
          filters.value.acmgClassifications.length > 0
        )
      default:
        return false
    }
  }

  // -------------------------------------------------------------------------
  // Filter manipulation
  // -------------------------------------------------------------------------

  const clearFilter = (filterId: string): void => {
    switch (filterId) {
      case 'search':
        filters.value.searchQuery = ''
        break
      case 'gene':
        filters.value.geneSymbol = ''
        break
      case 'impact':
        selectedImpactPresets.value = []
        break
      case 'consequences':
        filters.value.consequences = []
        break
      case 'funcs':
        filters.value.funcs = []
        break
      case 'clinvars':
        filters.value.clinvars = []
        break
      case 'frequency':
        filters.value.maxGnomadAf = null
        selectedAfPreset.value = null
        break
      case 'cadd':
        filters.value.minCadd = null
        selectedCaddPreset.value = null
        break
      case 'tags':
        filters.value.tagIds = []
        break
      case 'starred':
        filters.value.starredOnly = false
        break
      case 'commented':
        filters.value.hasCommentOnly = false
        break
      case 'acmg':
        filters.value.acmgClassifications = []
        break
      case 'annotationScope':
        filters.value.annotationScope = 'case'
        break
    }
  }

  const removeTagFilter = (tagId: number) => {
    filters.value.tagIds = filters.value.tagIds.filter((id) => id !== tagId)
  }

  const clearAllFilters = () => {
    filters.value.searchQuery = ''
    filters.value.geneSymbol = ''
    filters.value.consequences = []
    filters.value.funcs = []
    filters.value.clinvars = []
    filters.value.maxGnomadAf = null
    filters.value.minCadd = null
    filters.value.tagIds = []
    filters.value.starredOnly = false
    filters.value.hasCommentOnly = false
    filters.value.acmgClassifications = []
    filters.value.annotationScope = 'case'
    resetPresets()
    // Also reset sort order in parent
    onResetSort()
  }

  // -------------------------------------------------------------------------
  // Gene autocomplete
  // -------------------------------------------------------------------------

  const handleGeneClear = (): void => {
    filters.value.geneSymbol = ''
    geneSymbolSuggestions.value = []
  }

  const searchGeneSymbols = async (query: string) => {
    if (!query || query.length < 2) {
      geneSymbolSuggestions.value = []
      return
    }

    loadingSuggestions.value = true
    try {
      // Use optimized geneSymbols API - direct LIKE query instead of FTS5
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: string[] = await (api as any).variants.geneSymbols(caseIdRef.value, query, 50)
      geneSymbolSuggestions.value = results
    } catch {
      geneSymbolSuggestions.value = []
    } finally {
      loadingSuggestions.value = false
    }
  }

  // -------------------------------------------------------------------------
  // Watchers
  // -------------------------------------------------------------------------

  // Watch filters and emit changes
  watch(
    filters,
    () => {
      debouncedEmit()
    },
    { deep: true }
  )

  // -------------------------------------------------------------------------
  // Case switching and filter options loading
  // -------------------------------------------------------------------------

  /**
   * Reset all filters for a case switch (without triggering sort reset)
   */
  const resetForCaseSwitch = () => {
    filters.value.searchQuery = ''
    filters.value.geneSymbol = ''
    filters.value.consequences = []
    filters.value.funcs = []
    filters.value.clinvars = []
    filters.value.maxGnomadAf = null
    filters.value.minCadd = null
    filters.value.tagIds = []
    filters.value.starredOnly = false
    filters.value.hasCommentOnly = false
    filters.value.acmgClassifications = []
    filters.value.annotationScope = 'case'
    resetPresets()
  }

  // LRU cache for filter options per case
  const FILTER_OPTIONS_CACHE_MAX = 20
  const filterOptionsCache = new Map<number, FilterOptions>()

  /**
   * Store options in the LRU cache (delete+re-insert moves to end; evict from front)
   */
  const cacheFilterOptions = (caseId: number, options: FilterOptions): void => {
    if (filterOptionsCache.has(caseId)) filterOptionsCache.delete(caseId)
    filterOptionsCache.set(caseId, options)
    while (filterOptionsCache.size > FILTER_OPTIONS_CACHE_MAX) {
      const oldestKey = filterOptionsCache.keys().next().value
      if (oldestKey === undefined) break
      filterOptionsCache.delete(oldestKey)
    }
  }

  /**
   * Load filter options for a given case from the database (with LRU cache)
   */
  const loadFilterOptions = async (caseId: number): Promise<void> => {
    // Guard for browser dev mode
    if (!api) {
      return
    }

    // Check cache first
    const cached = filterOptionsCache.get(caseId)
    if (cached) {
      filterOptions.value = cached
      return
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options = await (api as any).variants.getFilterOptions(caseId)
      filterOptions.value = options
      cacheFilterOptions(caseId, options)
    } catch (error) {
      console.error('Failed to load filter options:', error)
    }
  }

  /**
   * Invalidate the filter options cache (call after import/delete)
   */
  const invalidateFilterOptionsCache = (): void => {
    filterOptionsCache.clear()
  }

  // Watch caseId prop and reset filters when case changes
  watch(caseIdRef, async (newCaseId, oldCaseId) => {
    if (newCaseId !== oldCaseId && oldCaseId !== undefined) {
      // Reset all filters when switching cases
      resetForCaseSwitch()

      // Emit reset filters immediately (bypass debounce for case switch)
      onFiltersUpdate({})

      // Reload filter options for the new case
      await loadFilterOptions(newCaseId)
    }
  })

  // -------------------------------------------------------------------------
  // Initial search
  // -------------------------------------------------------------------------

  /**
   * Set initial search query (e.g., from cohort navigation)
   */
  const setInitialSearch = (search: string) => {
    if (search !== undefined && search !== '') {
      filters.value.searchQuery = search
    }
  }

  // -------------------------------------------------------------------------
  // Initial load helper
  // -------------------------------------------------------------------------

  /**
   * Load filter options and tags in parallel.
   * Called from the component's onMounted.
   */
  const loadFilterOptionsAndTags = async (caseId: number): Promise<void> => {
    // Guard for browser dev mode
    if (!api) {
      console.warn('API not available - running outside Electron')
      return
    }

    // Check cache first for filter options
    const cached = filterOptionsCache.get(caseId)
    if (cached) {
      // Options are cached — only need to load tags
      filterOptions.value = cached
      await loadTags()
      return
    }

    try {
      // Load filter options and tags in parallel
      const [options] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (api as any).variants.getFilterOptions(caseId),
        loadTags()
      ])
      filterOptions.value = options
      cacheFilterOptions(caseId, options)
    } catch (error) {
      console.error('Failed to load filter options:', error)
    }
  }

  // Expose loadFilterOptionsAndTags as loadFilterOptions for initial mount
  // (overrides the simpler loadFilterOptions for case switch)
  const loadFilterOptionsPublic = async (caseId: number): Promise<void> => {
    await loadFilterOptionsAndTags(caseId)
  }

  // -------------------------------------------------------------------------
  // Return
  // -------------------------------------------------------------------------

  return {
    // State
    filters,
    filterOptions,
    geneSymbolSuggestions,
    loadingSuggestions,
    selectedImpactPresets,
    selectedAfPreset,
    selectedCaddPreset,
    exporting,

    // Presets (readonly)
    afPresets,
    caddPresets,
    impactPresets,

    // Tags
    availableTags,

    // Computed
    hasActiveFilters,
    activeFilterCount,
    activeFiltersList,

    // Methods
    isFilterGroupActive,
    clearFilter,
    removeTagFilter,
    clearAllFilters,
    handleGeneClear,
    searchGeneSymbols,
    emitFilters,
    loadFilterOptions: loadFilterOptionsPublic,
    invalidateFilterOptionsCache,
    resetForCaseSwitch,
    setInitialSearch,
    exportToExcel
  }
}
