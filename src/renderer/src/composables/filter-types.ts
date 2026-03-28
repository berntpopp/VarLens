import type { Ref, ComputedRef } from 'vue'
import type { VariantFilter, Tag, FilterOptions } from '../../../shared/types/api'

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
  annotationScope: 'case' | 'all'
  activePanelIds: number[]
  panelPaddingBp: number
  maxInternalAf: number | null
  inheritanceModes: string[]
  analysisGroupId: number | null
  considerPhasing: boolean
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
  exportToExcel: (caseId: number, caseName: string) => Promise<ExportResult | null>
}

/**
 * Build a VariantFilter object (without case_id) from filter state and impact presets.
 * Shared between emitFilters and exportToExcel to eliminate duplication.
 */
export function buildFilterFromState(
  filters: FilterState,
  selectedImpactPresets: string[]
): Omit<VariantFilter, 'case_id'> {
  const variantFilter: Omit<VariantFilter, 'case_id'> = {}

  if (filters.searchQuery !== '') {
    variantFilter.search_query = filters.searchQuery
  }
  if (filters.geneSymbol != null && filters.geneSymbol !== '') {
    variantFilter.gene_symbol = filters.geneSymbol
  }

  const allConsequences = [...selectedImpactPresets, ...filters.consequences]
  if (allConsequences.length > 0) {
    variantFilter.consequences = [...new Set(allConsequences)]
  }

  if (filters.funcs.length > 0) {
    variantFilter.funcs = [...filters.funcs]
  }
  if (filters.clinvars.length > 0) {
    variantFilter.clinvars = [...filters.clinvars]
  }

  const afValue = filters.maxGnomadAf
  if (afValue !== null && Number.isNaN(afValue) === false && afValue > 0) {
    variantFilter.gnomad_af_max = afValue
  }

  const caddValue = filters.minCadd
  if (caddValue !== null && Number.isNaN(caddValue) === false && caddValue >= 0) {
    variantFilter.cadd_min = caddValue
  }

  if (filters.tagIds.length > 0) {
    variantFilter.tag_ids = [...filters.tagIds]
  }
  if (filters.starredOnly) {
    variantFilter.starred_only = true
  }
  if (filters.hasCommentOnly) {
    variantFilter.has_comment = true
  }
  if (filters.acmgClassifications.length > 0) {
    variantFilter.acmg_classifications = [...filters.acmgClassifications]
  }
  if (filters.annotationScope === 'all') {
    variantFilter.annotation_scope = 'all'
  }

  if (filters.activePanelIds.length > 0) {
    variantFilter.active_panel_ids = [...filters.activePanelIds]
    variantFilter.panel_padding_bp = filters.panelPaddingBp
  }

  const internalAfValue = filters.maxInternalAf
  if (internalAfValue !== null && Number.isNaN(internalAfValue) === false && internalAfValue > 0) {
    variantFilter.max_internal_af = internalAfValue
  }

  if (filters.inheritanceModes.length > 0) {
    variantFilter.inheritance_modes = [...filters.inheritanceModes]
  }
  if (filters.analysisGroupId !== null) {
    variantFilter.analysis_group_id = filters.analysisGroupId
  }
  if (filters.considerPhasing) {
    variantFilter.consider_phasing = true
  }

  return variantFilter
}
