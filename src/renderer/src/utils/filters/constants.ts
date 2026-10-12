/**
 * Shared filter constants
 *
 * Extracted from FilterToolbar.vue and CohortFilterBar.vue to avoid duplication.
 * ACMG values use canonical sentence-case labels from domain.config.
 */
import {
  ACMG_CLASSIFICATIONS,
  ACMG_ABBREV,
  ACMG_COLORS
} from '../../../../shared/config/domain.config'

/**
 * ACMG classification filter options (short labels for chips), coloured like
 * the row chips.
 */
export const ACMG_FILTER_OPTIONS = ACMG_CLASSIFICATIONS.map((value) => ({
  value,
  label: ACMG_ABBREV[value],
  color: ACMG_COLORS[value]
}))

/**
 * ACMG classification filter options with full labels
 */
export const ACMG_FILTER_OPTIONS_LONG = ACMG_CLASSIFICATIONS.map((value) => ({
  value,
  label: value,
  color: ACMG_COLORS[value]
}))

export { ACMG_CLASSIFICATIONS, ACMG_ABBREV }
