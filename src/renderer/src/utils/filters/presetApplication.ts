/**
 * Shared logic for applying database-backed filter presets to filter state.
 *
 * Used by both FilterToolbar (case view) and CohortFilterBar (cohort view)
 * to avoid duplicating the reset-then-merge pattern.
 */

import type { Ref } from 'vue'
import type { FilterState } from '../../../../shared/types/filters'

/**
 * Minimal filter shape that all filter state variants share.
 * Both the case-view FilterState and cohort FilterState satisfy this.
 */
interface FilterFields {
  maxGnomadAf: number | null
  minCadd: number | null
  consequences: string[]
  funcs: string[]
  clinvars: string[]
  starredOnly: boolean
  hasCommentOnly: boolean
  acmgClassifications: string[]
  minCohortFrequency?: number | null
  minCarriers?: number | null
}

/**
 * Options for applying preset state to filters.
 * The `consequencesTarget` allows cohort view to redirect consequences
 * to `selectedImpactPresets` instead of `filters.consequences`.
 */
interface ApplyPresetOptions {
  /** The reactive filter state ref (any shape that has the common filter fields) */
  filters: Ref<FilterFields>
  /** Merged preset state from getActiveFilterState() */
  presetState: Partial<FilterState>
  /** Optional: separate ref for consequences (cohort uses selectedImpactPresets) */
  consequencesTarget?: Ref<string[]>
  /** Optional: include cohort-specific fields (minCohortFrequency, minCarriers) */
  includeCohortFields?: boolean
}

/**
 * Reset preset-managed filter fields to defaults, then apply the merged
 * preset state. Handles both case and cohort filter architectures.
 */
export function applyPresetStateToFilters({
  filters,
  presetState,
  consequencesTarget,
  includeCohortFields
}: ApplyPresetOptions): void {
  // Step 1: Reset all preset-manageable fields to defaults
  filters.value.maxGnomadAf = null
  filters.value.minCadd = null
  filters.value.consequences = []
  filters.value.funcs = []
  filters.value.clinvars = []
  filters.value.starredOnly = false
  filters.value.hasCommentOnly = false
  filters.value.acmgClassifications = []

  if (includeCohortFields === true) {
    filters.value.minCohortFrequency = null
    filters.value.minCarriers = null
  }

  // Also reset the separate consequences target if provided
  if (consequencesTarget !== undefined) {
    consequencesTarget.value = []
  }

  // Step 2: Apply merged preset state on top of defaults
  if (presetState.maxGnomadAf !== undefined) filters.value.maxGnomadAf = presetState.maxGnomadAf
  if (presetState.minCadd !== undefined) filters.value.minCadd = presetState.minCadd
  if (presetState.funcs !== undefined) filters.value.funcs = presetState.funcs
  if (presetState.clinvars !== undefined) filters.value.clinvars = presetState.clinvars
  if (presetState.starredOnly !== undefined) filters.value.starredOnly = presetState.starredOnly
  if (presetState.hasCommentOnly !== undefined)
    filters.value.hasCommentOnly = presetState.hasCommentOnly
  if (presetState.acmgClassifications !== undefined)
    filters.value.acmgClassifications = presetState.acmgClassifications

  // Consequences: route to the correct target
  if (presetState.consequences !== undefined) {
    if (consequencesTarget !== undefined) {
      consequencesTarget.value = presetState.consequences
    } else {
      filters.value.consequences = presetState.consequences
    }
  }

  // Cohort-specific fields
  if (includeCohortFields === true) {
    if (presetState.minCohortFrequency !== undefined)
      filters.value.minCohortFrequency = presetState.minCohortFrequency
    if (presetState.minCarriers !== undefined) filters.value.minCarriers = presetState.minCarriers
  }
}
