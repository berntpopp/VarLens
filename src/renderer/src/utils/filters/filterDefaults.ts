/**
 * Default filter values - single source of truth
 *
 * Used by clearFilter(), clearAllFilters(), and component initialization.
 * Consolidates default values that were duplicated across components.
 *
 * DRY-06: Single source of truth for filter defaults.
 */

import type { FilterState } from '../../../../shared/types/filters'

/**
 * Default filter values
 * Used by clearFilter(), clearAllFilters(), and component initialization
 *
 * @remarks
 * - String filters default to empty string
 * - Array filters default to empty array
 * - Numeric filters default to null (disabled)
 */
export const FILTER_DEFAULTS: Readonly<FilterState> = Object.freeze({
  geneSymbol: '',
  searchQuery: '',
  consequences: [],
  funcs: [],
  clinvars: [],
  maxGnomadAf: null,
  minCadd: null,
  minCohortFrequency: null,
  minCarriers: null,
  starredOnly: false,
  hasCommentOnly: false,
  acmgClassifications: [],
  activePanelIds: [],
  panelPaddingBp: 5000,
  maxInternalAf: null,
  inheritanceModes: [],
  analysisGroupId: null,
  considerPhasing: false
})
