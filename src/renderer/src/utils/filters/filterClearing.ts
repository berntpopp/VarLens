/**
 * Filter clearing utilities
 *
 * Pure functions for clearing individual or all filters.
 * Extracts the duplicate 8-case switch from CohortTable.vue and FilterToolbar.vue.
 *
 * DRY-02: Eliminate duplicate clearFilter switch statements.
 */

import type { FilterState } from '../../../../shared/types/filters'
import { FILTER_DEFAULTS } from './filterDefaults'

/**
 * Valid filter IDs for clearing
 */
export type FilterId =
  | 'search'
  | 'gene'
  | 'impact'
  | 'funcs'
  | 'clinvars'
  | 'frequency'
  | 'cadd'
  | 'carriers'
  | 'starred'
  | 'comments'
  | 'acmg'
  | 'panels'
  | 'internal-frequency'
  | 'inheritance'

/**
 * Clear a specific filter, returning partial state update
 * Pure function - no reactive state
 *
 * @param filterId - The filter to clear
 * @returns Partial FilterState with cleared values
 *
 * @example
 * ```typescript
 * // In component with reactive state:
 * const handleClearFilter = (id: FilterId) => {
 *   Object.assign(filters.value, clearFilter(id))
 * }
 * ```
 */
export function clearFilter(filterId: FilterId): Partial<FilterState> {
  switch (filterId) {
    case 'search':
      return { searchQuery: FILTER_DEFAULTS.searchQuery }
    case 'gene':
      return { geneSymbol: FILTER_DEFAULTS.geneSymbol }
    case 'impact':
      return { consequences: [...FILTER_DEFAULTS.consequences] }
    case 'funcs':
      return { funcs: [...FILTER_DEFAULTS.funcs] }
    case 'clinvars':
      return { clinvars: [...FILTER_DEFAULTS.clinvars] }
    case 'frequency':
      return { maxGnomadAf: FILTER_DEFAULTS.maxGnomadAf }
    case 'cadd':
      return { minCadd: FILTER_DEFAULTS.minCadd }
    case 'carriers':
      return { minCarriers: FILTER_DEFAULTS.minCarriers }
    case 'starred':
      return { starredOnly: FILTER_DEFAULTS.starredOnly }
    case 'comments':
      return { hasCommentOnly: FILTER_DEFAULTS.hasCommentOnly }
    case 'acmg':
      return { acmgClassifications: [...FILTER_DEFAULTS.acmgClassifications] }
    case 'panels':
      return {
        activePanelIds: [...FILTER_DEFAULTS.activePanelIds],
        panelPaddingBp: FILTER_DEFAULTS.panelPaddingBp
      }
    case 'internal-frequency':
      return { maxInternalAf: FILTER_DEFAULTS.maxInternalAf }
    case 'inheritance':
      return {
        inheritanceModes: [...FILTER_DEFAULTS.inheritanceModes],
        analysisGroupId: FILTER_DEFAULTS.analysisGroupId,
        considerPhasing: FILTER_DEFAULTS.considerPhasing
      }
    default:
      return {}
  }
}

/**
 * Get fresh default filter state
 * Returns new object to avoid mutation of shared constant
 *
 * @returns Fresh FilterState with all defaults
 *
 * @example
 * ```typescript
 * // Reset all filters:
 * filters.value = clearAllFilters()
 * ```
 */
export function clearAllFilters(): FilterState {
  return {
    geneSymbol: FILTER_DEFAULTS.geneSymbol,
    searchQuery: FILTER_DEFAULTS.searchQuery,
    consequences: [...FILTER_DEFAULTS.consequences],
    funcs: [...FILTER_DEFAULTS.funcs],
    clinvars: [...FILTER_DEFAULTS.clinvars],
    maxGnomadAf: FILTER_DEFAULTS.maxGnomadAf,
    minCadd: FILTER_DEFAULTS.minCadd,
    minCarriers: FILTER_DEFAULTS.minCarriers,
    starredOnly: FILTER_DEFAULTS.starredOnly,
    hasCommentOnly: FILTER_DEFAULTS.hasCommentOnly,
    acmgClassifications: [...FILTER_DEFAULTS.acmgClassifications],
    activePanelIds: [...FILTER_DEFAULTS.activePanelIds],
    panelPaddingBp: FILTER_DEFAULTS.panelPaddingBp,
    maxInternalAf: FILTER_DEFAULTS.maxInternalAf,
    inheritanceModes: [...FILTER_DEFAULTS.inheritanceModes],
    analysisGroupId: FILTER_DEFAULTS.analysisGroupId,
    considerPhasing: FILTER_DEFAULTS.considerPhasing
  }
}
