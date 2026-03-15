/**
 * Active filters list computation
 *
 * Pure function for building active filters list for chip display.
 * Extracts duplicate logic from CohortTable.vue and FilterToolbar.vue.
 *
 * DRY-08: Eliminate duplicate activeFiltersList logic.
 */

import type { FilterState, ActiveFilter } from '../../../../shared/types/filters'

/**
 * Build active filters list for chip display
 * Pure function - components wrap in computed() for reactivity
 *
 * @param filters - Current filter state
 * @param impactPresets - Selected impact preset names (optional)
 * @returns Array of active filters for chip display
 *
 * @example
 * ```typescript
 * // In component:
 * const activeFiltersList = computed(() =>
 *   buildActiveFiltersList(filters.value, selectedImpactPresets.value)
 * )
 * ```
 */
export function buildActiveFiltersList(
  filters: FilterState,
  impactPresets: string[] = []
): ActiveFilter[] {
  const list: ActiveFilter[] = []

  // Search/text filters
  if (filters.searchQuery !== '') {
    list.push({ id: 'search', label: 'Search', value: filters.searchQuery })
  }
  if (filters.geneSymbol !== '') {
    list.push({ id: 'gene', label: 'Gene', value: filters.geneSymbol })
  }

  // Impact - from presets or consequences array
  if (impactPresets.length > 0) {
    list.push({ id: 'impact', label: 'Impact', value: impactPresets.join(', ') })
  } else if (filters.consequences.length > 0) {
    list.push({ id: 'impact', label: 'Impact', value: `${filters.consequences.length} selected` })
  }

  // Array filters
  if (filters.funcs.length > 0) {
    list.push({ id: 'funcs', label: 'Function', value: `${filters.funcs.length} selected` })
  }
  if (filters.clinvars.length > 0) {
    list.push({ id: 'clinvars', label: 'ClinVar', value: `${filters.clinvars.length} selected` })
  }

  // Numeric filters - operator goes in value for cleaner chip display
  if (filters.maxGnomadAf !== null && filters.maxGnomadAf > 0) {
    const pct = (filters.maxGnomadAf * 100).toFixed(2)
    list.push({ id: 'frequency', label: 'AF', value: `<= ${pct}%` })
  }
  if (filters.minCadd !== null && filters.minCadd >= 0) {
    list.push({ id: 'cadd', label: 'CADD', value: `>= ${filters.minCadd}` })
  }
  if (filters.minCohortFrequency !== null && filters.minCohortFrequency > 0) {
    const pct = (filters.minCohortFrequency * 100).toFixed(1)
    list.push({ id: 'cohortFreq', label: 'Cohort', value: `>= ${pct}%` })
  }
  if (filters.minCarriers !== null && filters.minCarriers > 0) {
    list.push({ id: 'carriers', label: 'Carriers', value: `>= ${filters.minCarriers}` })
  }

  // Annotation filters
  if (filters.starredOnly) {
    list.push({ id: 'starred', label: 'Starred', value: 'only' })
  }
  if (filters.hasCommentOnly) {
    list.push({ id: 'comments', label: 'Comments', value: 'only' })
  }
  if (filters.acmgClassifications.length > 0) {
    list.push({ id: 'acmg', label: 'ACMG', value: filters.acmgClassifications.join(', ') })
  }

  return list
}
