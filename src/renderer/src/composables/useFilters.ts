/**
 * Composable for filter state management with preset sync
 *
 * Uses provide/inject pattern: a parent component creates filters with
 * createFilters() and provides them, child components consume via useFilters().
 *
 * Provides:
 * - Core filter state (gene, consequences, funcs, clinvars, numeric filters)
 * - Preset selections for common filter values
 * - Bidirectional sync between presets and custom inputs
 * - hasActiveFilters computed for UI feedback
 * - activeFiltersList for chip-based filter summary
 * - clearAllFilters and clearFilter methods
 * - reset() for database context changes
 * - getIpcParams() for IPC-safe parameter generation
 */

import { ref, computed, watch, inject } from 'vue'
import type { Ref, ComputedRef, InjectionKey } from 'vue'
import {
  clearFilter as clearFilterUtil,
  buildActiveFiltersList,
  buildIpcParams,
  type FilterId,
  type ActiveFilter,
  type FilterIpcParams
} from '../utils/filters'

/**
 * NULL Handling Policy (ANTI-10)
 *
 * Numeric filters (gnomAD AF, CADD, cohort frequency) use NULL-inclusive semantics:
 * - NULL values in database PASS numeric filter conditions
 * - This prevents excluding novel/unannotated variants that lack external data
 *
 * Example: minCadd=20 matches variants where cadd >= 20 OR cadd IS NULL
 * Rationale: A variant without CADD annotation isn't necessarily benign
 *
 * This policy was established in Phase 26 (BUG-01, BUG-02) for consistency
 * between mock API and production database queries.
 */

/**
 * Valid ranges for numeric filters (ANTI-12)
 * - Cohort frequency: 0-100% (user input), stored as 0-1 decimal
 * - gnomAD AF: 0-100% (user input), stored as 0-1 decimal
 * - CADD score: 0-60 (raw phred score)
 */
const FILTER_RANGES = {
  cohortFreqPercent: { min: 0, max: 100 },
  gnomadAfPercent: { min: 0, max: 100 },
  cadd: { min: 0, max: 60 }
} as const

/**
 * Core filter state structure
 */
export interface FilterState {
  /** Gene symbol filter */
  geneSymbol: string
  /** Impact consequences to include */
  consequences: string[]
  /** Functional consequence types to include */
  funcs: string[]
  /** ClinVar classifications to include */
  clinvars: string[]
  /** Maximum gnomAD allele frequency (decimal, 0-1) */
  maxGnomadAf: number | null
  /** Minimum CADD phred score */
  minCadd: number | null
  /** Minimum cohort frequency (decimal, 0-1) */
  minCohortFrequency: number | null
  /** Minimum carrier count */
  minCarriers: number | null
  /** Show only starred variants */
  starredOnly: boolean
  /** Show only variants with comments */
  hasCommentOnly: boolean
  /** Filter by ACMG classifications */
  acmgClassifications: string[]
  /** Active gene panel IDs for region-based filtering */
  activePanelIds: number[]
  /** Padding in base pairs around panel gene regions */
  panelPaddingBp: number
  /** Maximum internal database allele frequency (0-1) */
  maxInternalAf: number | null
  /** Selected inheritance mode filters (multi-select) */
  inheritanceModes: string[]
  /** Active analysis group ID for trio filtering */
  analysisGroupId: number | null
  /** Consider phasing information for compound het */
  considerPhasing: boolean
}

/**
 * Return type for useFilters composable
 */
export interface UseFiltersReturn {
  // Core filter state
  filters: Ref<FilterState>
  searchTerm: Ref<string>

  // Preset selections
  selectedImpactPresets: Ref<string[]>
  selectedCohortFreqPreset: Ref<number | null>
  selectedAfPreset: Ref<number | null>
  selectedCaddPreset: Ref<number | null>

  // Custom numeric inputs (percentage units for user)
  customCohortFreq: Ref<number | null>
  customGnomadAf: Ref<number | null>
  customCadd: Ref<number | null>

  // Computed
  hasActiveFilters: ComputedRef<boolean>
  activeFiltersList: ComputedRef<ActiveFilter[]>

  // Actions
  clearAllFilters: () => void
  clearFilter: (filterId: string) => void
  reset: () => void
  getIpcParams: () => FilterIpcParams
}

/**
 * Injection key for filter state
 */
export const FiltersKey: InjectionKey<UseFiltersReturn> = Symbol('filters')

/**
 * Create initial filter state
 */
function createInitialFilterState(): FilterState {
  return {
    geneSymbol: '',
    consequences: [],
    funcs: [],
    clinvars: [],
    maxGnomadAf: null,
    minCadd: null,
    maxInternalAf: null,
    minCohortFrequency: null,
    minCarriers: null,
    starredOnly: false,
    hasCommentOnly: false,
    acmgClassifications: [],
    activePanelIds: [],
    panelPaddingBp: 5000,
    inheritanceModes: [],
    analysisGroupId: null,
    considerPhasing: false
  }
}

/**
 * Factory function that creates a new filter state instance.
 *
 * Call this in a parent component and provide it via FiltersKey.
 * Child components then consume via useFilters().
 *
 * @returns Object with filter state refs and management methods
 *
 * @example
 * ```typescript
 * // In parent component
 * import { provide } from 'vue'
 * import { FiltersKey, createFilters } from '../composables/useFilters'
 *
 * const filters = createFilters()
 * provide(FiltersKey, filters)
 * ```
 */
export function createFilters(): UseFiltersReturn {
  // Core filter state
  const filters = ref<FilterState>(createInitialFilterState())
  const searchTerm = ref('')

  // Preset selections
  const selectedImpactPresets = ref<string[]>([])
  const selectedCohortFreqPreset = ref<number | null>(null)
  const selectedAfPreset = ref<number | null>(null)
  const selectedCaddPreset = ref<number | null>(null)

  // Custom inputs (percentage/raw values)
  const customCohortFreq = ref<number | null>(null) // Percentage (0-100)
  const customGnomadAf = ref<number | null>(null) // Percentage (0-100)
  const customCadd = ref<number | null>(null) // Raw CADD score

  // BIDIRECTIONAL SYNC: Preset -> Filter + clear custom
  watch(selectedCohortFreqPreset, (value) => {
    filters.value.minCohortFrequency = value
    if (value !== null) {
      customCohortFreq.value = null
    }
  })

  watch(selectedAfPreset, (value) => {
    filters.value.maxGnomadAf = value
    if (value !== null) {
      customGnomadAf.value = null
    }
  })

  watch(selectedCaddPreset, (value) => {
    filters.value.minCadd = value
    if (value !== null) {
      customCadd.value = null
    }
  })

  // Custom -> Filter + clear preset
  watch(customCohortFreq, (value) => {
    if (value === null || Number.isNaN(value)) return

    // ANTI-12: Validate range before applying
    if (
      value < FILTER_RANGES.cohortFreqPercent.min ||
      value > FILTER_RANGES.cohortFreqPercent.max
    ) {
      customCohortFreq.value = null
      return
    }

    if (value > 0) {
      // Convert percentage (0-100) to decimal (0-1)
      filters.value.minCohortFrequency = value / 100
      selectedCohortFreqPreset.value = null
    }
  })

  watch(customGnomadAf, (value) => {
    if (value === null || Number.isNaN(value)) return

    // ANTI-12: Validate range before applying
    if (value < FILTER_RANGES.gnomadAfPercent.min || value > FILTER_RANGES.gnomadAfPercent.max) {
      customGnomadAf.value = null
      return
    }

    if (value > 0) {
      // Convert percentage (0-100) to decimal (0-1)
      filters.value.maxGnomadAf = value / 100
      selectedAfPreset.value = null
    }
  })

  watch(customCadd, (value) => {
    if (value === null || Number.isNaN(value)) return

    // ANTI-12: Validate range before applying
    if (value < FILTER_RANGES.cadd.min || value > FILTER_RANGES.cadd.max) {
      customCadd.value = null
      return
    }

    if (value >= 0) {
      filters.value.minCadd = value
      selectedCaddPreset.value = null
    }
  })

  /**
   * Clear all filters and reset to initial state
   */
  function clearAllFilters(): void {
    searchTerm.value = ''
    filters.value = createInitialFilterState()
    selectedImpactPresets.value = []
    selectedCohortFreqPreset.value = null
    selectedAfPreset.value = null
    selectedCaddPreset.value = null
    customCohortFreq.value = null
    customGnomadAf.value = null
    customCadd.value = null
  }

  /**
   * Clear a specific filter by ID
   */
  function clearFilter(filterId: string): void {
    const partialUpdate = clearFilterUtil(filterId as FilterId)

    // Handle searchQuery -> searchTerm mapping
    if ('searchQuery' in partialUpdate) {
      searchTerm.value = partialUpdate.searchQuery as string
      delete partialUpdate.searchQuery
    }

    // Apply remaining filter updates
    Object.assign(filters.value, partialUpdate)

    // Clear associated presets and custom inputs
    switch (filterId) {
      case 'frequency':
        selectedAfPreset.value = null
        customGnomadAf.value = null
        break
      case 'cadd':
        selectedCaddPreset.value = null
        customCadd.value = null
        break
      case 'cohortFreq':
        selectedCohortFreqPreset.value = null
        customCohortFreq.value = null
        break
      case 'impact':
        selectedImpactPresets.value = []
        break
      case 'starred':
      case 'comments':
      case 'acmg':
        // Already handled by clearFilterUtil above
        break
    }
  }

  // Computed: has active filters
  const hasActiveFilters = computed(() => {
    const afActive =
      filters.value.maxGnomadAf !== null &&
      !Number.isNaN(filters.value.maxGnomadAf) &&
      filters.value.maxGnomadAf > 0
    const caddActive =
      filters.value.minCadd !== null &&
      !Number.isNaN(filters.value.minCadd) &&
      filters.value.minCadd >= 0
    const cohortFreqActive =
      filters.value.minCohortFrequency !== null &&
      !Number.isNaN(filters.value.minCohortFrequency) &&
      filters.value.minCohortFrequency > 0

    return (
      searchTerm.value !== '' ||
      filters.value.geneSymbol !== '' ||
      filters.value.consequences.length > 0 ||
      filters.value.funcs.length > 0 ||
      filters.value.clinvars.length > 0 ||
      afActive ||
      caddActive ||
      cohortFreqActive ||
      (filters.value.minCarriers !== null && filters.value.minCarriers > 0) ||
      filters.value.starredOnly ||
      filters.value.hasCommentOnly ||
      filters.value.acmgClassifications.length > 0 ||
      selectedImpactPresets.value.length > 0 ||
      selectedCohortFreqPreset.value !== null ||
      selectedAfPreset.value !== null ||
      selectedCaddPreset.value !== null
    )
  })

  // Computed: active filters list for chip display
  const activeFiltersList = computed<ActiveFilter[]>(() => {
    const stateWithSearch = {
      ...filters.value,
      searchQuery: searchTerm.value
    }
    return buildActiveFiltersList(stateWithSearch, selectedImpactPresets.value)
  })

  /**
   * Build IPC-safe filter parameters
   */
  function getIpcParams(): FilterIpcParams {
    const stateWithSearch = {
      ...filters.value,
      searchQuery: searchTerm.value
    }
    return buildIpcParams(stateWithSearch)
  }

  /**
   * Reset all state (alias for clearAllFilters, for database context changes)
   */
  function reset(): void {
    clearAllFilters()
  }

  return {
    filters,
    searchTerm,
    selectedImpactPresets,
    selectedCohortFreqPreset,
    selectedAfPreset,
    selectedCaddPreset,
    customCohortFreq,
    customGnomadAf,
    customCadd,
    hasActiveFilters,
    activeFiltersList,
    clearAllFilters,
    clearFilter,
    reset,
    getIpcParams
  }
}

/**
 * Consume filter state from a parent provider.
 *
 * Must be called inside a component that has a parent providing FiltersKey.
 *
 * @returns Object with filter state refs and management methods
 * @throws Error if called without a provider
 */
export function useFilters(): UseFiltersReturn {
  const filters = inject(FiltersKey)
  if (!filters) {
    throw new Error(
      'useFilters() called without provider. Wrap in a component that provides FiltersKey.'
    )
  }
  return filters
}
