/**
 * Composable for variant filter state management (facade)
 *
 * Thin facade that wires together sub-composables for filter state management.
 * The public API (UseFilterStateReturn) is unchanged from the monolithic version.
 *
 * Sub-composables:
 * - useFilterCore — shared consequences, funcs, clinvars, numeric thresholds
 * - useFilterPresets — impact/AF/CADD preset chips with bidirectional sync
 * - useGeneAutocomplete — gene symbol suggestions via IPC
 * - useFilterOptionsCache — filter options loading with LRU cache
 * - useFilterComputed — active filter tracking and manipulation
 * - useFilterLifecycle — case-switch watcher, reset, initial search
 * - useFilterExport — Excel export
 */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { useFilterEmitScheduler } from './useFilterEmitScheduler'
import { useTags } from './useTags'
import { useApiService } from './useApiService'
import { createFilterState } from '../../../shared/filters/filterDefaults'
import { buildVariantFilterFromState } from '../utils/filters/filterSerialization'
import {
  type FilterState,
  type UseFilterStateOptions,
  type UseFilterStateReturn
} from './filter-types'
import { useFilterPresets } from './useFilterPresets'
import { useFilterExport } from './useFilterExport'
import { useFilterCore } from './useFilterCore'
import { useGeneAutocomplete } from './useGeneAutocomplete'
import { useFilterOptionsCache } from './useFilterOptionsCache'
import { useFilterComputed } from './useFilterComputed'
import { useFilterLifecycle } from './useFilterLifecycle'

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
  const { onFiltersUpdate, onResetSort, onCaseSwitch } = options

  // -------------------------------------------------------------------------
  // 1. Core, API, Tags
  // -------------------------------------------------------------------------

  const core = useFilterCore()
  const { api } = useApiService()
  const { loadTags, getTags } = useTags()

  // -------------------------------------------------------------------------
  // 2. Filter state
  // -------------------------------------------------------------------------

  const filters = ref<FilterState>(createFilterState())

  // -------------------------------------------------------------------------
  // 3. Helpers: syncCoreToFilters and resetAdapterFields
  // -------------------------------------------------------------------------

  /** Sync core state back to the filters ref. Call after any core mutation. */
  function syncCoreToFilters(): void {
    filters.value.consequences = core.consequences.value
    filters.value.funcs = core.funcs.value
    filters.value.clinvars = core.clinvars.value
    filters.value.maxGnomadAf = core.gnomadAfMax.value
    filters.value.minCadd = core.caddMin.value
    filters.value.maxInternalAf = core.maxInternalAf.value
    filters.value.acmgClassifications = core.acmgClassifications.value
  }

  // -------------------------------------------------------------------------
  // 4. Presets (delegated to useFilterPresets)
  // -------------------------------------------------------------------------

  const {
    selectedImpactPresets,
    selectedAfPreset,
    selectedCaddPreset,
    afPresets,
    caddPresets,
    impactPresets,
    resetPresets
  } = useFilterPresets(filters, () => emitNow())

  // -------------------------------------------------------------------------
  // 5. Filter emission with debounce
  // -------------------------------------------------------------------------

  const emitFilters = () => {
    const variantFilter = buildVariantFilterFromState(filters.value, selectedImpactPresets.value)
    onFiltersUpdate(variantFilter)
  }

  // Discrete changes apply immediately; typed fields wait 250 ms (shared with cohort)
  const { emitNow, onStateChange } = useFilterEmitScheduler(emitFilters)

  // Watch filters and emit changes (serialized key avoids deep traversal)
  const filterEmitKey = computed(() => JSON.stringify(filters.value))
  watch(filterEmitKey, onStateChange)

  // Export state
  const exporting = ref(false)
  const { exportToExcel } = useFilterExport(filters, selectedImpactPresets, exporting)

  // Available tags for filter
  const availableTags = computed(() => getTags())

  // -------------------------------------------------------------------------
  // 6. Delegate to sub-composables
  // -------------------------------------------------------------------------

  // Gene autocomplete
  const { geneSymbolSuggestions, loadingSuggestions, searchGeneSymbols, handleGeneClear } =
    useGeneAutocomplete(api, caseIdRef, filters)

  // Filter options cache
  const {
    filterOptions,
    loadFilterOptions: loadFilterOptionsInternal,
    loadFilterOptionsAndTags: loadFilterOptionsAndTagsInternal,
    invalidateFilterOptionsCache
  } = useFilterOptionsCache(api)

  // Filter computed properties and manipulation
  const {
    hasActiveFilters,
    activeFilterCount,
    activeFiltersList,
    isFilterGroupActive,
    clearFilter,
    removeTagFilter,
    clearAllFilters
  } = useFilterComputed({
    filters,
    selectedImpactPresets,
    availableTags,
    core,
    syncCoreToFilters,
    resetPresets,
    onResetSort,
    selectedAfPreset,
    selectedCaddPreset
  })

  // Filter lifecycle (case-switch watcher, reset, initial search)
  const { resetForCaseSwitch, setInitialSearch } = useFilterLifecycle({
    caseIdRef,
    filters,
    core,
    syncCoreToFilters,
    resetPresets,
    onFiltersUpdate,
    onCaseSwitch,
    loadFilterOptions: loadFilterOptionsInternal
  })

  // -------------------------------------------------------------------------
  // 7. Public loadFilterOptions wraps loadFilterOptionsAndTags
  // -------------------------------------------------------------------------

  const loadFilterOptionsPublic = async (caseId: number): Promise<void> => {
    await loadFilterOptionsAndTagsInternal(caseId, loadTags)
  }

  // -------------------------------------------------------------------------
  // Return — same UseFilterStateReturn shape
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
