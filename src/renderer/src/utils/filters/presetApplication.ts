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
  /** Internal cohort frequency threshold — same meaning in case and cohort view. */
  maxInternalAf: number | null
  /** Carrier cap, same meaning in case and cohort view. */
  maxCarriers: number | null
  minCadd: number | null
  consequences: string[]
  funcs: string[]
  clinvars: string[]
  starredOnly: boolean
  hasCommentOnly: boolean
  acmgClassifications: string[]
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
  /** Optional: include cohort-specific fields (minCarriers) */
  includeCohortFields?: boolean
}

/**
 * Reset preset-managed filter fields to defaults, then apply the merged
 * preset state. Handles both case and cohort filter architectures.
 *
 * Note: searchQuery and geneSymbol are intentionally NOT managed by presets.
 * These are ad-hoc user inputs that should persist independently of preset
 * toggles, so they are neither saved nor applied/reset on toggle.
 */
export function applyPresetStateToFilters({
  filters,
  presetState,
  consequencesTarget,
  includeCohortFields
}: ApplyPresetOptions): void {
  // Step 1: Reset all preset-manageable fields to defaults
  filters.value.maxGnomadAf = null
  filters.value.maxInternalAf = null
  filters.value.maxCarriers = null
  filters.value.minCadd = null
  filters.value.consequences = []
  filters.value.funcs = []
  filters.value.clinvars = []
  filters.value.starredOnly = false
  filters.value.hasCommentOnly = false
  filters.value.acmgClassifications = []

  if (includeCohortFields === true) {
    filters.value.minCarriers = null
  }

  // Also reset the separate consequences target if provided
  if (consequencesTarget !== undefined) {
    consequencesTarget.value = []
  }

  // Step 2: Apply merged preset state on top of defaults
  if (presetState.maxGnomadAf !== undefined) filters.value.maxGnomadAf = presetState.maxGnomadAf
  if (presetState.maxInternalAf !== undefined)
    filters.value.maxInternalAf = presetState.maxInternalAf
  if (presetState.maxCarriers !== undefined) filters.value.maxCarriers = presetState.maxCarriers
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
    if (presetState.minCarriers !== undefined) filters.value.minCarriers = presetState.minCarriers
  }
}

/**
 * The fields a preset manages (exactly those `applyPresetStateToFilters`
 * restores), without default-valued keys. Used on save, and on load to
 * normalise stored presets: an explicit null/false means "not set" and must
 * not override another active preset. `impactPresets` (the HIGH/MOD/LOW chips,
 * a separate ref) are saved as consequences.
 */
export function buildPresetFilterJson(
  filters: Partial<FilterState>,
  impactPresets: string[] = []
): Partial<FilterState> {
  const json: Partial<FilterState> = {}
  for (const key of [
    'maxGnomadAf',
    'maxInternalAf',
    'maxCarriers',
    'minCadd',
    'minCarriers'
  ] as const) {
    const value = filters[key]
    if (typeof value === 'number') json[key] = value
  }
  if (filters.starredOnly === true) json.starredOnly = true
  if (filters.hasCommentOnly === true) json.hasCommentOnly = true
  const consequences = [...new Set([...(filters.consequences ?? []), ...impactPresets])]
  if (consequences.length > 0) json.consequences = consequences
  for (const key of ['funcs', 'clinvars', 'acmgClassifications'] as const) {
    const value = filters[key]
    if (value !== undefined && value.length > 0) json[key] = [...value]
  }
  return json
}

/**
 * Check if a single preset's filter values still match the current filter state.
 * Returns false if any field the preset sets has diverged from the preset's value.
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((v, i) => v === sortedB[i])
}

interface DivergenceCheckOptions {
  filters: FilterFields
  presetFilterJson: Partial<FilterState>
  /** For cohort view: the separate consequences ref value */
  consequencesValue?: string[]
}

export function isPresetDiverged({
  filters,
  presetFilterJson,
  consequencesValue
}: DivergenceCheckOptions): boolean {
  const fj = buildPresetFilterJson(presetFilterJson) // explicit defaults are "not set"

  if (fj.maxGnomadAf !== undefined && filters.maxGnomadAf !== fj.maxGnomadAf) return true
  if (fj.maxInternalAf !== undefined && filters.maxInternalAf !== fj.maxInternalAf) return true
  if (fj.maxCarriers !== undefined && filters.maxCarriers !== fj.maxCarriers) return true
  if (fj.minCadd !== undefined && filters.minCadd !== fj.minCadd) return true
  if (fj.starredOnly !== undefined && filters.starredOnly !== fj.starredOnly) return true
  if (fj.hasCommentOnly !== undefined && filters.hasCommentOnly !== fj.hasCommentOnly) return true

  if (fj.consequences !== undefined) {
    const current = consequencesValue ?? filters.consequences
    if (!arraysEqual(current, fj.consequences)) return true
  }
  if (fj.funcs !== undefined && !arraysEqual(filters.funcs, fj.funcs)) return true
  if (fj.clinvars !== undefined && !arraysEqual(filters.clinvars, fj.clinvars)) return true
  if (fj.acmgClassifications !== undefined) {
    if (!arraysEqual(filters.acmgClassifications, fj.acmgClassifications)) return true
  }

  return false
}
