/**
 * Type definition for the filter state shared between CohortFilterBar and CohortFilterDrawer
 * via Vue provide/inject. This mirrors the case-view filterDrawerTypes.ts pattern but
 * adapted for cohort-specific filters (cohort frequency, no tags).
 */

import type { Ref, ComputedRef } from 'vue'
import type { FilterPreset } from '../../../../shared/types/filter-presets'
import type { Suggestion } from '../../dsl/autocomplete'
import type { DslParseError } from '../../dsl/types'
import type { ColumnFilter } from '../../../../shared/types/column-filters'

/**
 * Active filter representation for chip display
 */
export interface CohortActiveFilter {
  id: string
  label: string
  value: string
}

/**
 * Shape of the object provided by CohortFilterBar under the 'cohortFilterDrawerState' key.
 * CohortFilterDrawer injects this to access the same reactive filter state.
 */
export interface CohortFilterDrawerState {
  // Reactive filter state
  filters: Ref<{
    geneSymbol: string
    funcs: string[]
    clinvars: string[]
    maxGnomadAf: number | null
    minCadd: number | null
    minCohortFrequency: number | null
    starredOnly: boolean
    hasCommentOnly: boolean
    acmgClassifications: string[]
  }>
  searchTerm: Ref<string>

  // Preset selections
  selectedImpactPresets: Ref<string[]>
  selectedCohortFreqPreset: Ref<number | null>
  selectedAfPreset: Ref<number | null>
  selectedCaddPreset: Ref<number | null>

  // Custom numeric inputs
  customCohortFreq: Ref<number | null>
  customGnomadAf: Ref<number | null>
  customCadd: Ref<number | null>

  // Gene autocomplete
  geneSymbolSuggestions: Ref<string[]>
  loadingGeneSuggestions: Ref<boolean>

  // Preset constants
  impactPresets: readonly { label: string; value: string; color: string }[]
  cohortFreqPresets: readonly { label: string; value: number }[]
  afPresets: readonly { label: string; value: number }[]
  caddPresets: readonly { label: string; value: number }[]
  acmgFilterOptions: readonly { value: string; label: string; color: string }[]

  // Computed
  hasActiveFilters: ComputedRef<boolean>
  activeFilterCount: ComputedRef<number>
  activeFiltersList: ComputedRef<CohortActiveFilter[]>

  // Methods
  isFilterGroupActive: (groupId: string) => boolean
  clearAllFilters: () => void
  clearFilter: (id: string) => void
  searchGeneSymbols: (query: string) => void

  // Preset store (optional)
  visiblePresets?: ComputedRef<FilterPreset[]>
  isPresetActive?: (id: number) => boolean
  onPresetToggle?: (id: number) => void
  onPresetSave?: () => void
  onPresetManage?: () => void
  hasActiveFiltersForSave?: ComputedRef<boolean>

  // DSL search state
  dslInput?: Ref<string>
  dslSuggestions?: Ref<Suggestion[]>
  isDslMode?: ComputedRef<boolean>
  dslErrors?: ComputedRef<DslParseError[]>
  onDslApply?: () => void
  onDslClear?: () => void
  onDslSuggestionSelect?: (suggestion: Suggestion) => void
  dslColumnFilters?: Ref<Record<string, ColumnFilter>>
}
