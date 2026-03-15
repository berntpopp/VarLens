/**
 * Composable for managing database-backed filter presets.
 *
 * Loads presets from the backend, tracks which are active (toggled on),
 * and provides a merged filter state from all active presets.
 */

import { ref, computed } from 'vue'
import type {
  FilterPreset,
  FilterPresetCreate,
  FilterPresetUpdate
} from '../../../shared/types/filter-presets'
import type { FilterState } from '../../../shared/types/filters'

export function useFilterPresetStore() {
  const presets = ref<FilterPreset[]>([])
  const activePresetIds = ref<Set<number>>(new Set())
  const loading = ref(false)

  const visiblePresets = computed(() => presets.value.filter((p) => p.isVisible))

  async function loadPresets(): Promise<void> {
    loading.value = true
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (window as any).api.presets.list()
      presets.value = Array.isArray(result) ? result : []
    } finally {
      loading.value = false
    }
  }

  function togglePreset(id: number): void {
    const newSet = new Set(activePresetIds.value)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    activePresetIds.value = newSet
  }

  function isPresetActive(id: number): boolean {
    return activePresetIds.value.has(id)
  }

  function clearActivePresets(): void {
    activePresetIds.value = new Set()
  }

  /**
   * Merge all active presets' filterJson into a single Partial<FilterState>.
   * Later presets (by sort order) override earlier ones for scalar fields.
   * Array fields are concatenated and deduplicated.
   */
  function getActiveFilterState(): Partial<FilterState> {
    const active = presets.value.filter((p) => activePresetIds.value.has(p.id))
    const merged: Partial<FilterState> = {}

    for (const preset of active) {
      const fj = preset.filterJson
      // Scalar fields: last wins
      if (fj.maxGnomadAf !== undefined) merged.maxGnomadAf = fj.maxGnomadAf
      if (fj.minCadd !== undefined) merged.minCadd = fj.minCadd
      if (fj.minCohortFrequency !== undefined) merged.minCohortFrequency = fj.minCohortFrequency
      if (fj.minCarriers !== undefined) merged.minCarriers = fj.minCarriers
      if (fj.searchQuery !== undefined) merged.searchQuery = fj.searchQuery
      if (fj.geneSymbol !== undefined) merged.geneSymbol = fj.geneSymbol
      if (fj.starredOnly !== undefined) merged.starredOnly = fj.starredOnly
      if (fj.hasCommentOnly !== undefined) merged.hasCommentOnly = fj.hasCommentOnly

      // Array fields: concatenate and deduplicate
      if (fj.consequences !== undefined && fj.consequences.length > 0) {
        merged.consequences = [...new Set([...(merged.consequences ?? []), ...fj.consequences])]
      }
      if (fj.funcs !== undefined && fj.funcs.length > 0) {
        merged.funcs = [...new Set([...(merged.funcs ?? []), ...fj.funcs])]
      }
      if (fj.clinvars !== undefined && fj.clinvars.length > 0) {
        merged.clinvars = [...new Set([...(merged.clinvars ?? []), ...fj.clinvars])]
      }
      if (fj.acmgClassifications !== undefined && fj.acmgClassifications.length > 0) {
        merged.acmgClassifications = [
          ...new Set([...(merged.acmgClassifications ?? []), ...fj.acmgClassifications])
        ]
      }
    }

    return merged
  }

  async function savePreset(params: FilterPresetCreate): Promise<FilterPreset> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (window as any).api.presets.create(params)
    await loadPresets()
    return created
  }

  async function updatePreset(id: number, updates: FilterPresetUpdate): Promise<FilterPreset> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (window as any).api.presets.update(id, updates)
    await loadPresets()
    return updated
  }

  async function deletePreset(id: number): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).api.presets.delete(id)
    activePresetIds.value.delete(id)
    await loadPresets()
  }

  async function reorderPresets(items: { id: number; sortOrder: number }[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (window as any).api.presets.reorder(items)
    await loadPresets()
  }

  return {
    presets,
    visiblePresets,
    activePresetIds,
    loading,
    loadPresets,
    togglePreset,
    isPresetActive,
    clearActivePresets,
    getActiveFilterState,
    savePreset,
    updatePreset,
    deletePreset,
    reorderPresets
  }
}
