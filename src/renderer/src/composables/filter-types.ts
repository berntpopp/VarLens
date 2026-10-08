import type { Ref, ComputedRef } from 'vue'
import type { FilterOptions, VariantFilter } from '../../../shared/types/api'
import type { Tag } from '../../../shared/types/database-entities'
import type { FilterState, ActiveFilter } from '../../../shared/types/filters'
import { createFilterState } from '../../../shared/filters/filterDefaults'
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
  filterOptions: Readonly<Ref<FilterOptions>>
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
  loadFilterOptions: () => Promise<void>
  resetForCaseSwitch: () => void
  setInitialSearch: (search: string) => void
  exportToExcel: (
    caseId: number,
    caseName: string,
    format?: ExportFormat,
    tableFilters?: Omit<VariantFilter, 'case_id'>
  ) => Promise<ExportResult | null>
}

/**
 * Reset every field on a FilterState ref to its default.
 *
 * Shared by useFilterComputed (clearAllFilters) and useFilterLifecycle
 * (resetForCaseSwitch).
 */
export function resetAdapterFields(filters: Ref<FilterState>): void {
  Object.assign(filters.value, createFilterState())
}
