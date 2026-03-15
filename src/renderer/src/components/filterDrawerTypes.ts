/**
 * Type definition for the filter state shared between FilterToolbar and FilterDrawer
 * via Vue provide/inject. This avoids circular imports and keeps the injection key typed.
 */

import type { Ref, ComputedRef } from 'vue'
import type { FilterState, ActiveFilter } from '../composables/useFilterState'
import type { Tag, FilterOptions } from '../../../shared/types/api'
import type { FilterPreset } from '../../../shared/types/filter-presets'
import type { Suggestion } from '../dsl/autocomplete'
import type { DslParseError } from '../dsl/types'

/**
 * Shape of the object provided by FilterToolbar under the 'filterDrawerState' key.
 * FilterDrawer injects this to access the same reactive filter state.
 */
export interface FilterDrawerState {
  // Reactive state
  filters: Ref<FilterState>
  filterOptions: Ref<FilterOptions>
  geneSymbolSuggestions: Ref<string[]>
  loadingSuggestions: Ref<boolean>
  selectedImpactPresets: Ref<string[]>
  selectedAfPreset: Ref<number | null>
  selectedCaddPreset: Ref<number | null>

  // Preset constants
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

  // Preset store (optional — only present when preset system is active)
  visiblePresets?: ComputedRef<FilterPreset[]>
  isPresetActive?: (id: number) => boolean
  onPresetToggle?: (id: number) => void
  onPresetSave?: () => void
  onPresetManage?: () => void
  hasActiveFiltersForSave?: ComputedRef<boolean>

  // DSL search state (shared with DslSearchBar in drawer)
  dslInput?: Ref<string>
  dslSuggestions?: Ref<Suggestion[]>
  isDslMode?: ComputedRef<boolean>
  dslErrors?: ComputedRef<DslParseError[]>
  onDslApply?: () => void
  onDslClear?: () => void
  onDslSuggestionSelect?: (suggestion: Suggestion) => void
}
