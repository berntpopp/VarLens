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
 * - Preset selections with bidirectional sync
 * - Active filter tracking (count, list, per-group check)
 * - Filter manipulation (clear, remove tag, clear all)
 * - Gene autocomplete with debounced IPC
 * - Filter emission with debounce
 * - Case-switch reset and filter options reload
 * - Excel export
 */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { useDebounce } from './useDebounce'
import { useTags } from './useTags'
import { useApiService } from './useApiService'
import type { VariantFilter, Tag, FilterOptions } from '../../../shared/types/api'
import { APP_CONFIG } from '../../../shared/config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Core filter state structure for variant filtering
 */
export interface FilterState {
  searchQuery: string
  geneSymbol: string
  consequences: string[]
  funcs: string[]
  clinvars: string[]
  maxGnomadAf: number | null
  minCadd: number | null
  tagIds: number[]
  starredOnly: boolean
  hasCommentOnly: boolean
  acmgClassifications: string[]
}

/**
 * Active filter chip data for summary bar display
 */
export interface ActiveFilter {
  id: string
  label: string
  value: string
}

/**
 * Options for configuring the useFilterState composable
 */
export interface UseFilterStateOptions {
  /** Callback when filters update (replaces emit('update:filters')) */
  onFiltersUpdate: (filters: Omit<VariantFilter, 'case_id'>) => void
  /** Callback to reset sort order (replaces emit('reset-sort')) */
  onResetSort: () => void
  /** Optional ref indicating whether a sort is active (used in hasActiveFilters) */
  hasSortRef?: Ref<boolean | undefined>
}

/**
 * Export result returned by exportToExcel
 */
export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
  cancelled?: boolean
}

/**
 * Return type for the useFilterState composable
 */
export interface UseFilterStateReturn {
  // State
  filters: Ref<FilterState>
  filterOptions: Ref<FilterOptions>
  geneSymbolSuggestions: Ref<string[]>
  loadingSuggestions: Ref<boolean>
  selectedImpactPresets: Ref<string[]>
  selectedAfPreset: Ref<number | null>
  selectedCaddPreset: Ref<number | null>
  exporting: Ref<boolean>

  // Presets (readonly arrays)
  afPresets: readonly { label: string; value: number }[]
  caddPresets: readonly { label: string; value: number }[]
  impactPresets: readonly { label: string; value: string; color: string }[]

  // Tags
  availableTags: ComputedRef<Tag[]>

  // Computed
  hasActiveFilters: ComputedRef<boolean>
  activeFilterCount: ComputedRef<number>
  activeFiltersList: ComputedRef<ActiveFilter[]>

  // Methods
  isFilterGroupActive: (groupId: string) => boolean
  clearFilter: (filterId: string) => void
  removeTagFilter: (tagId: number) => void
  clearAllFilters: () => void
  handleGeneClear: () => void
  searchGeneSymbols: (query: string) => Promise<void>
  emitFilters: () => void
  loadFilterOptions: (caseId: number) => Promise<void>
  resetForCaseSwitch: () => void
  setInitialSearch: (search: string) => void
  exportToExcel: (caseId: number, caseName: string) => Promise<ExportResult | null>
}

// ---------------------------------------------------------------------------
// Preset constants
// ---------------------------------------------------------------------------

const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
] as const

const caddPresets = [
  { label: '10', value: 10 },
  { label: '15', value: 15 },
  { label: '20', value: 20 },
  { label: '25', value: 25 }
] as const

const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
] as const

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
  const { onFiltersUpdate, onResetSort, hasSortRef } = options

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
    acmgClassifications: [] as string[]
  })

  // Filter options loaded from database
  const filterOptions = ref<FilterOptions>({
    consequences: [] as string[],
    funcs: [] as string[],
    clinvars: [] as string[],
    minCadd: null as number | null,
    maxCadd: null as number | null,
    minGnomadAf: null as number | null,
    maxGnomadAf: null as number | null
  })

  // Gene autocomplete state
  const geneSymbolSuggestions = ref<string[]>([])
  const loadingSuggestions = ref(false)

  // Export state
  const exporting = ref(false)

  // Preset selections
  const selectedImpactPresets = ref<string[]>([])
  const selectedAfPreset = ref<number | null>(null)
  const selectedCaddPreset = ref<number | null>(null)

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
      filters.value.acmgClassifications.length > 0 ||
      (hasSortRef !== undefined && hasSortRef.value === true)
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
      list.push({ id: 'frequency', label: 'AF ≤', value: `${pct}%` })
    }
    if (
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    ) {
      list.push({ id: 'cadd', label: 'CADD ≥', value: String(filters.value.minCadd) })
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
    selectedAfPreset.value = null
    selectedCaddPreset.value = null
    selectedImpactPresets.value = []
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
  // Filter emission
  // -------------------------------------------------------------------------

  /**
   * Build VariantFilter from current state and invoke the callback
   */
  const emitFilters = () => {
    const variantFilter: Omit<VariantFilter, 'case_id'> = {}

    if (filters.value.searchQuery !== '') {
      variantFilter.search_query = filters.value.searchQuery
    }

    if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') {
      variantFilter.gene_symbol = filters.value.geneSymbol
    }

    // Combine impact presets with specific consequences (OR logic)
    const allConsequences = [...selectedImpactPresets.value, ...filters.value.consequences]
    if (allConsequences.length > 0) {
      variantFilter.consequences = [...new Set(allConsequences)] // Dedupe
    }

    // Add funcs filter
    if (filters.value.funcs.length > 0) {
      variantFilter.funcs = filters.value.funcs
    }

    // Add clinvars filter
    if (filters.value.clinvars.length > 0) {
      variantFilter.clinvars = filters.value.clinvars
    }

    // Only include gnomAD AF if it's a valid positive number
    const afValue = filters.value.maxGnomadAf
    if (afValue !== null && Number.isNaN(afValue) === false && afValue > 0) {
      variantFilter.gnomad_af_max = afValue
    }

    // Only include CADD if it's a valid non-negative number
    const caddValue = filters.value.minCadd
    if (caddValue !== null && Number.isNaN(caddValue) === false && caddValue >= 0) {
      variantFilter.cadd_min = caddValue
    }

    // Add tag filter
    if (filters.value.tagIds.length > 0) {
      variantFilter.tag_ids = filters.value.tagIds
    }

    // Annotation filters
    if (filters.value.starredOnly) {
      variantFilter.starred_only = true
    }
    if (filters.value.hasCommentOnly) {
      variantFilter.has_comment = true
    }
    if (filters.value.acmgClassifications.length > 0) {
      variantFilter.acmg_classifications = filters.value.acmgClassifications
    }

    onFiltersUpdate(variantFilter)
  }

  // Create debounced version
  const { debouncedFn: debouncedEmit } = useDebounce(emitFilters, APP_CONFIG.DEBOUNCE_MS)

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

  // Watch preset selections and sync with text inputs
  watch(selectedAfPreset, (value) => {
    if (value !== null) {
      filters.value.maxGnomadAf = value
    }
  })

  watch(selectedCaddPreset, (value) => {
    if (value !== null) {
      filters.value.minCadd = value
    }
  })

  // Watch impact presets and emit filter changes
  watch(selectedImpactPresets, () => {
    debouncedEmit()
  })

  // Watch text inputs and sync with preset selections
  watch(
    () => filters.value.maxGnomadAf,
    (value) => {
      if (value !== null) {
        // Check if value matches a preset
        const matchingPreset = afPresets.find((p) => p.value === value)
        selectedAfPreset.value = matchingPreset !== undefined ? matchingPreset.value : null
      } else {
        selectedAfPreset.value = null
      }
    }
  )

  watch(
    () => filters.value.minCadd,
    (value) => {
      if (value !== null) {
        // Check if value matches a preset
        const matchingPreset = caddPresets.find((p) => p.value === value)
        selectedCaddPreset.value = matchingPreset !== undefined ? matchingPreset.value : null
      } else {
        selectedCaddPreset.value = null
      }
    }
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
    selectedAfPreset.value = null
    selectedCaddPreset.value = null
    selectedImpactPresets.value = []
  }

  /**
   * Load filter options for a given case from the database
   */
  const loadFilterOptions = async (caseId: number): Promise<void> => {
    // Guard for browser dev mode
    if (!api) {
      return
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options = await (api as any).variants.getFilterOptions(caseId)
      filterOptions.value = options
    } catch (error) {
      console.error('Failed to load filter options:', error)
    }
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
  // Export to Excel
  // -------------------------------------------------------------------------

  /**
   * Build current filter state and export to Excel
   *
   * @param caseId - Case ID to export
   * @param caseName - Case name for the file name
   * @returns Export result or null if cancelled / window.api unavailable
   */
  const exportToExcel = async (caseId: number, caseName: string): Promise<ExportResult | null> => {
    // Guard for browser dev mode
    if (!api) {
      console.warn('API not available - running outside Electron')
      return null
    }

    exporting.value = true
    try {
      // Build current filter state
      const exportFilters: Omit<VariantFilter, 'case_id'> = {}

      if (filters.value.searchQuery !== '') {
        exportFilters.search_query = filters.value.searchQuery
      }

      if (filters.value.geneSymbol != null && filters.value.geneSymbol !== '') {
        exportFilters.gene_symbol = filters.value.geneSymbol
      }

      const allConsequences = [...selectedImpactPresets.value, ...filters.value.consequences]
      if (allConsequences.length > 0) {
        exportFilters.consequences = [...new Set(allConsequences)]
      }

      if (filters.value.funcs.length > 0) {
        exportFilters.funcs = filters.value.funcs
      }

      if (filters.value.clinvars.length > 0) {
        exportFilters.clinvars = filters.value.clinvars
      }

      const afValue = filters.value.maxGnomadAf
      if (afValue !== null && Number.isNaN(afValue) === false && afValue > 0) {
        exportFilters.gnomad_af_max = afValue
      }

      const caddValue = filters.value.minCadd
      if (caddValue !== null && Number.isNaN(caddValue) === false && caddValue >= 0) {
        exportFilters.cadd_min = caddValue
      }

      if (filters.value.tagIds.length > 0) {
        exportFilters.tag_ids = filters.value.tagIds
      }

      if (filters.value.starredOnly) {
        exportFilters.starred_only = true
      }
      if (filters.value.hasCommentOnly) {
        exportFilters.has_comment = true
      }
      if (filters.value.acmgClassifications.length > 0) {
        exportFilters.acmg_classifications = filters.value.acmgClassifications
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).export.variants(
        caseId,
        exportFilters,
        caseName !== '' ? caseName : `case_${caseId}`
      )

      // Check for error response (SerializableError has code property)
      if (result !== null && result !== undefined && 'code' in result) {
        return {
          success: false,
          error: result.message ?? result.userMessage ?? 'Unknown error'
        }
      }

      if (result !== null && result !== undefined && result.success === true) {
        return {
          success: true,
          filePath: result.filePath
        }
      } else if (
        result !== null &&
        result !== undefined &&
        typeof result.error === 'string' &&
        result.error !== 'Export cancelled'
      ) {
        return {
          success: false,
          error: result.error
        }
      }

      // Cancelled or no result
      return result?.error === 'Export cancelled' ? { success: false, cancelled: true } : null
    } catch (error) {
      console.error('Export error:', error)
      return null
    } finally {
      exporting.value = false
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

    try {
      // Load filter options and tags in parallel
      const [options] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (api as any).variants.getFilterOptions(caseId),
        loadTags()
      ])
      filterOptions.value = options
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
    resetForCaseSwitch,
    setInitialSearch,
    exportToExcel
  }
}
