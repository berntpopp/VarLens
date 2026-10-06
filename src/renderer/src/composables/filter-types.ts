import type { Ref, ComputedRef } from 'vue'
import type { FilterOptions, VariantFilter } from '../../../shared/types/api'
import type { Tag } from '../../../shared/types/database-entities'
import type { FilterState, ActiveFilter } from '../../../shared/types/filters'
import { FILTER_DEFAULTS } from '../../../shared/filters/filterDefaults'
import type { ExportFormat } from '../../../shared/ipc/domains/export'
export { buildVariantFilterFromState as buildFilterFromState } from '../utils/filters/filterSerialization'

// Re-export for existing consumers
export type { FilterState, ActiveFilter } from '../../../shared/types/filters'

/**
 * Options for configuring the useFilterState composable
 */
export interface UseFilterStateOptions {
  /** Callback when filters update (replaces emit('update:filters')) */
  onFiltersUpdate: (filters: Omit<VariantFilter, 'case_id'>) => void
  /** Callback to reset sort order (replaces emit('reset-sort')) */
  onResetSort: () => void
  /** Callback when case switches — used to clear UI state like DSL column filters */
  onCaseSwitch?: () => void
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
  invalidateFilterOptionsCache: () => void
  resetForCaseSwitch: () => void
  setInitialSearch: (search: string) => void
  exportToExcel: (
    caseId: number,
    caseName: string,
    format?: ExportFormat
  ) => Promise<ExportResult | null>
}

/**
 * Reset adapter-specific fields on a FilterState ref to their defaults.
 *
 * Shared by useFilterComputed (clearAllFilters) and useFilterLifecycle
 * (resetForCaseSwitch) to avoid duplicating the field-by-field reset.
 */
export function resetAdapterFields(filters: Ref<FilterState>): void {
  filters.value.searchQuery = FILTER_DEFAULTS.searchQuery
  filters.value.geneSymbol = FILTER_DEFAULTS.geneSymbol
  filters.value.tagIds = []
  filters.value.starredOnly = FILTER_DEFAULTS.starredOnly
  filters.value.hasCommentOnly = FILTER_DEFAULTS.hasCommentOnly
  filters.value.annotationScope = FILTER_DEFAULTS.annotationScope
  filters.value.activePanelIds = []
  filters.value.panelPaddingBp = FILTER_DEFAULTS.panelPaddingBp
  filters.value.inheritanceModes = []
  filters.value.analysisGroupId = FILTER_DEFAULTS.analysisGroupId
  filters.value.considerPhasing = FILTER_DEFAULTS.considerPhasing
  filters.value.columnFilters = { ...FILTER_DEFAULTS.columnFilters }
}
