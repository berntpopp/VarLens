import { ref, watch, type Ref } from 'vue'
import type { FilterState } from './filter-types'

// ---------------------------------------------------------------------------
// Preset constants
// ---------------------------------------------------------------------------

export const afPresets = [
  { label: '<= 1%', value: 0.01 },
  { label: '<= 0.1%', value: 0.001 },
  { label: '<= 0.01%', value: 0.0001 }
] as const

export const caddPresets = [
  { label: '>= 10', value: 10 },
  { label: '>= 15', value: 15 },
  { label: '>= 20', value: 20 },
  { label: '>= 25', value: 25 }
] as const

export const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
] as const

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

/**
 * Composable for filter preset management.
 * Manages impact, AF, and CADD preset selections with bidirectional
 * sync between preset chips and text inputs.
 *
 * @param filters - Reactive ref to the core filter state
 * @param onPresetsChange - Called when preset selection changes require filter re-emission
 */
export function useFilterPresets(filters: Ref<FilterState>, onPresetsChange: () => void) {
  // Preset selections
  const selectedImpactPresets = ref<string[]>([])
  const selectedAfPreset = ref<number | null>(null)
  const selectedCaddPreset = ref<number | null>(null)

  // --- Preset -> filter sync ---

  // Deselecting clears the field only while it still holds the preset's value,
  // so a number typed over an active preset survives.
  watch(selectedAfPreset, (value, old) => {
    if (value !== null) {
      filters.value.maxGnomadAf = value
    } else if (filters.value.maxGnomadAf === old) {
      filters.value.maxGnomadAf = null
    }
  })

  watch(selectedCaddPreset, (value, old) => {
    if (value !== null) {
      filters.value.minCadd = value
    } else if (filters.value.minCadd === old) {
      filters.value.minCadd = null
    }
  })

  // Impact presets trigger filter re-emission
  watch(selectedImpactPresets, () => {
    onPresetsChange()
  })

  // --- Filter -> preset sync ---

  watch(
    () => filters.value.maxGnomadAf,
    (value) => {
      if (value !== null) {
        const matching = afPresets.find((p) => p.value === value)
        selectedAfPreset.value = matching !== undefined ? matching.value : null
      } else {
        selectedAfPreset.value = null
      }
    }
  )

  watch(
    () => filters.value.minCadd,
    (value) => {
      // An emptied v-model.number field holds '', which would pass `>= 0` checks
      if (typeof value !== 'number') filters.value.minCadd = null
      if (value !== null) {
        const matching = caddPresets.find((p) => p.value === value)
        selectedCaddPreset.value = matching !== undefined ? matching.value : null
      } else {
        selectedCaddPreset.value = null
      }
    }
  )

  /**
   * Reset all preset selections (called during clearAllFilters / case switch)
   */
  const resetPresets = () => {
    selectedAfPreset.value = null
    selectedCaddPreset.value = null
    selectedImpactPresets.value = []
  }

  return {
    selectedImpactPresets,
    selectedAfPreset,
    selectedCaddPreset,
    afPresets,
    caddPresets,
    impactPresets,
    resetPresets
  }
}
