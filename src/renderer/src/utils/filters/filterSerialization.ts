import type { ColumnFiltersParam } from '../../../../shared/types/column-filters'
import type { VariantFilter } from '../../../../shared/types/api'
import type { FilterIpcParams, FilterState } from '../../../../shared/types/filters'
import { stripVueProxies } from '../stripVueProxies'

/**
 * Sprint A A2 (Pass-9 #4): this serializer runs in renderer-reachable code and
 * receives `FilterState` whose fields may still be Vue reactive()/ref() proxies
 * (callers spread `filters.value` shallowly — see `useFilters.getIpcParams()`,
 * `useFilterState`, and `AssociationConfigPanel.handleRun()`).
 *
 * Each exported function now calls `stripVueProxies` on its input up front, so
 * callers can pass reactive state directly without remembering to strip first.
 * `stripVueProxies` deep-clones into plain JS that is safe to ship over IPC,
 * which is also why this module is renderer-only (it depends on Vue) rather than
 * living under `src/shared`.
 */
function cloneColumnFilters(columnFilters: ColumnFiltersParam): ColumnFiltersParam {
  return stripVueProxies(columnFilters)
}

export function buildFilterIpcParams(filters: FilterState): FilterIpcParams {
  const plainState = stripVueProxies(filters)
  const params: FilterIpcParams = {}

  if (plainState.searchQuery !== undefined && plainState.searchQuery !== '') {
    params.search_term = plainState.searchQuery
  }
  if (plainState.geneSymbol !== undefined && plainState.geneSymbol !== '') {
    params.gene_symbol = plainState.geneSymbol
  }

  if ((plainState.consequences?.length ?? 0) > 0) {
    params.consequences = [...plainState.consequences]
  }
  if ((plainState.funcs?.length ?? 0) > 0) {
    params.funcs = [...plainState.funcs]
  }
  if ((plainState.clinvars?.length ?? 0) > 0) {
    params.clinvars = [...plainState.clinvars]
  }

  // typeof: an emptied v-model.number field holds '' (and '' >= 0 is true)
  if (
    typeof plainState.maxGnomadAf === 'number' &&
    Number.isNaN(plainState.maxGnomadAf) === false &&
    plainState.maxGnomadAf > 0
  ) {
    params.gnomad_af_max = plainState.maxGnomadAf
  }
  if (
    typeof plainState.minCadd === 'number' &&
    Number.isNaN(plainState.minCadd) === false &&
    plainState.minCadd >= 0
  ) {
    params.cadd_min = plainState.minCadd
  }
  if (
    typeof plainState.minCarriers === 'number' &&
    Number.isNaN(plainState.minCarriers) === false &&
    plainState.minCarriers > 0
  ) {
    params.carrier_count_min = plainState.minCarriers
  }

  if (plainState.starredOnly) {
    params.starred_only = true
  }
  if (plainState.hasCommentOnly) {
    params.has_comment = true
  }
  if ((plainState.acmgClassifications?.length ?? 0) > 0) {
    params.acmg_classifications = [...plainState.acmgClassifications]
  }

  if ((plainState.activePanelIds?.length ?? 0) > 0) {
    params.active_panel_ids = [...plainState.activePanelIds]
    params.panel_padding_bp = plainState.panelPaddingBp
  }

  if (
    typeof plainState.maxInternalAf === 'number' &&
    Number.isNaN(plainState.maxInternalAf) === false &&
    plainState.maxInternalAf > 0
  ) {
    params.max_internal_af = Math.min(plainState.maxInternalAf, 1)
  }

  if ((plainState.inheritanceModes?.length ?? 0) > 0) {
    params.inheritance_modes = [...plainState.inheritanceModes]
  }
  if (plainState.analysisGroupId !== null && plainState.analysisGroupId !== undefined) {
    params.analysis_group_id = plainState.analysisGroupId
  }
  if (plainState.considerPhasing) {
    params.consider_phasing = true
  }

  if (plainState.columnFilters !== undefined && Object.keys(plainState.columnFilters).length > 0) {
    // Already plain JS (stripped above); reuse the helper for an isolated copy.
    params.column_filters = cloneColumnFilters(plainState.columnFilters)
  }

  return params
}

export function buildVariantFilterFromState(
  filters: FilterState,
  selectedImpactPresets: string[]
): Omit<VariantFilter, 'case_id'> {
  const plainState = stripVueProxies(filters)
  const variantFilter: Omit<VariantFilter, 'case_id'> = {}
  const ipcParams = buildFilterIpcParams(plainState)

  if (ipcParams.search_term !== undefined) {
    variantFilter.search_query = ipcParams.search_term
  }
  if (ipcParams.gene_symbol !== undefined) {
    variantFilter.gene_symbol = ipcParams.gene_symbol
  }
  if (ipcParams.funcs !== undefined) {
    variantFilter.funcs = ipcParams.funcs
  }
  if (ipcParams.clinvars !== undefined) {
    variantFilter.clinvars = ipcParams.clinvars
  }
  if (ipcParams.gnomad_af_max !== undefined) {
    variantFilter.gnomad_af_max = ipcParams.gnomad_af_max
  }
  if (ipcParams.cadd_min !== undefined) {
    variantFilter.cadd_min = ipcParams.cadd_min
  }
  if (ipcParams.has_comment !== undefined) {
    variantFilter.has_comment = ipcParams.has_comment
  }
  if (ipcParams.acmg_classifications !== undefined) {
    variantFilter.acmg_classifications = ipcParams.acmg_classifications
  }
  if (ipcParams.active_panel_ids !== undefined) {
    variantFilter.active_panel_ids = ipcParams.active_panel_ids
    variantFilter.panel_padding_bp = ipcParams.panel_padding_bp
  }
  if (ipcParams.max_internal_af !== undefined) {
    variantFilter.max_internal_af = ipcParams.max_internal_af
  }
  if (ipcParams.inheritance_modes !== undefined) {
    variantFilter.inheritance_modes = ipcParams.inheritance_modes
  }
  if (ipcParams.analysis_group_id !== undefined) {
    variantFilter.analysis_group_id = ipcParams.analysis_group_id
  }
  if (ipcParams.consider_phasing !== undefined) {
    variantFilter.consider_phasing = ipcParams.consider_phasing
  }
  if (ipcParams.column_filters !== undefined) {
    variantFilter.column_filters = ipcParams.column_filters
  }

  const allConsequences = [...(selectedImpactPresets ?? []), ...(plainState.consequences ?? [])]
  if (allConsequences.length > 0) {
    variantFilter.consequences = [...new Set(allConsequences)]
  }
  if ((plainState.tagIds?.length ?? 0) > 0) {
    variantFilter.tag_ids = [...plainState.tagIds]
  }
  if (ipcParams.starred_only !== undefined) {
    variantFilter.starred_only = ipcParams.starred_only
  }
  if (plainState.annotationScope === 'all') {
    variantFilter.annotation_scope = 'all'
  }

  return variantFilter
}

export const buildIpcParams = buildFilterIpcParams
