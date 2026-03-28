/**
 * Filter serialization utilities
 *
 * Pure function for building IPC-safe filter parameters from FilterState.
 * Consolidates duplicate param building logic from CohortTable.vue and FilterToolbar.vue.
 *
 * DRY-07: Eliminate duplicate IPC param building.
 * DRY-09: Consolidate filter-building logic for fetch and export.
 */

import type { FilterState, FilterIpcParams } from '../../../../shared/types/filters'

/**
 * Build IPC-safe filter parameters from FilterState
 *
 * - Converts camelCase to snake_case for database compatibility
 * - Excludes undefined/null/empty values (IPC structured clone rejects undefined)
 * - Clones arrays to avoid Vue proxy issues
 *
 * Used by both data fetching (emitFilters) and export operations (exportToExcel)
 * to ensure consistent filter serialization (DRY-09).
 *
 * @param filters - Current filter state
 * @returns IPC-safe parameter object
 *
 * @example
 * ```typescript
 * const ipcParams = buildIpcParams(filters.value)
 * const result = await window.api.cohort.getVariants({
 *   ...ipcParams,
 *   limit: 100,
 *   offset: 0
 * })
 * ```
 */
export function buildIpcParams(filters: FilterState): FilterIpcParams {
  const params: FilterIpcParams = {}

  // String filters - only include non-empty
  if (filters.searchQuery !== '') {
    params.search_term = filters.searchQuery
  }
  if (filters.geneSymbol !== '') {
    params.gene_symbol = filters.geneSymbol
  }

  // Array filters - only include non-empty, clone for IPC
  if (filters.consequences.length > 0) {
    params.consequences = [...filters.consequences]
  }
  if (filters.funcs.length > 0) {
    params.funcs = [...filters.funcs]
  }
  if (filters.clinvars.length > 0) {
    params.clinvars = [...filters.clinvars]
  }

  // Numeric filters - only include valid non-null values
  if (
    filters.maxGnomadAf !== null &&
    !Number.isNaN(filters.maxGnomadAf) &&
    filters.maxGnomadAf > 0
  ) {
    params.gnomad_af_max = filters.maxGnomadAf
  }
  if (filters.minCadd !== null && !Number.isNaN(filters.minCadd) && filters.minCadd >= 0) {
    params.cadd_min = filters.minCadd
  }
  if (
    filters.maxInternalAf !== null &&
    !Number.isNaN(filters.maxInternalAf) &&
    filters.maxInternalAf > 0
  ) {
    params.max_internal_af = Math.min(filters.maxInternalAf, 1)
  }
  if (
    filters.minCohortFrequency !== null &&
    !Number.isNaN(filters.minCohortFrequency) &&
    filters.minCohortFrequency > 0
  ) {
    params.cohort_frequency_min = filters.minCohortFrequency
  }
  if (
    filters.minCarriers !== null &&
    !Number.isNaN(filters.minCarriers) &&
    filters.minCarriers > 0
  ) {
    params.carrier_count_min = filters.minCarriers
  }

  // Inheritance filters
  if (filters.inheritanceModes.length > 0) {
    params.inheritance_modes = [...filters.inheritanceModes]
  }
  if (filters.analysisGroupId !== null) {
    params.analysis_group_id = filters.analysisGroupId
  }
  if (filters.considerPhasing) {
    params.consider_phasing = true
  }

  // Annotation filters
  if (filters.starredOnly) {
    params.starred_only = true
  }
  if (filters.hasCommentOnly) {
    params.has_comment = true
  }
  if (filters.acmgClassifications.length > 0) {
    params.acmg_classifications = [...filters.acmgClassifications]
  }

  return params
}
