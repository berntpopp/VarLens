/**
 * Composable for managing database-backed filter presets.
 *
 * The preset list is server data and lives in the query cache
 * (`queries/filter-presets.ts`), so every consumer sees the same list and it
 * follows the open database. Which presets are toggled on is UI state and
 * stays here.
 *
 * **Per-view active set:** which presets are active is kept per scope ('case'
 * vs 'cohort'); a single shared set leaked the case view's active preset chip
 * into the cohort view (and the reverse), so cohort and case filter state were
 * not isolated (P0-3).
 */

import { ref, computed, type Ref } from 'vue'
import { useQuery, useQueryCache } from '@pinia/colada'
import type {
  FilterPreset,
  FilterPresetCreate,
  FilterPresetUpdate
} from '../../../shared/types/filter-presets'
import type { FilterState } from '../../../shared/types/filters'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { filterPresetsQuery } from '../queries/filter-presets'
import { loadIfAllowed, queryApi } from '../queries/gate'
import { queryKeys } from '../queries/keys'

export type PresetScope = 'case' | 'cohort'

const activeByScope: Record<PresetScope, Ref<Set<number>>> = {
  case: ref(new Set<number>()),
  cohort: ref(new Set<number>())
}

/** Clear the active presets of both views. For unit tests only. */
export function __resetFilterPresetStoreForTest(): void {
  activeByScope.case.value = new Set()
  activeByScope.cohort.value = new Set()
}

export function useFilterPresetStore(scope: PresetScope = 'case') {
  const cache = useQueryCache()
  const { data, isLoading: loading, refresh } = useQuery(filterPresetsQuery)
  const presets = computed<FilterPreset[]>(() => data.value ?? [])
  const visiblePresets = computed(() => presets.value.filter((p) => p.isVisible))
  const activePresetIds = activeByScope[scope]

  /** Resolves once the list is loaded; concurrent callers share one request. */
  function loadPresets(): Promise<void> {
    return loadIfAllowed('workflow.filterPresets', () => refresh(true))
  }

  /** Refetch after this client changed the preset table. */
  async function reloadPresets(): Promise<void> {
    await cache.invalidateQueries({ key: queryKeys.filterPresets() })
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
      if (fj.maxInternalAf !== undefined) merged.maxInternalAf = fj.maxInternalAf
      if (fj.minCadd !== undefined) merged.minCadd = fj.minCadd
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
    const created = unwrapIpcResult(await queryApi().presets.create(params))
    await reloadPresets()
    return created
  }

  async function updatePreset(id: number, updates: FilterPresetUpdate): Promise<FilterPreset> {
    const updated = unwrapIpcResult(await queryApi().presets.update(id, updates))
    await reloadPresets()
    return updated
  }

  async function deletePreset(id: number): Promise<void> {
    unwrapIpcResult(await queryApi().presets.delete(id))
    // Reassign Set to trigger Vue reactivity (in-place Set.delete doesn't)
    const newSet = new Set(activePresetIds.value)
    newSet.delete(id)
    activePresetIds.value = newSet
    await reloadPresets()
  }

  async function reorderPresets(items: { id: number; sortOrder: number }[]): Promise<void> {
    unwrapIpcResult(await queryApi().presets.reorder(items))
    await reloadPresets()
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
