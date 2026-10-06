/**
 * Composable for managing database-backed filter presets.
 *
 * Loads presets from the backend, tracks which are active (toggled on),
 * and provides a merged filter state from all active presets.
 *
 * **Singleton state:** the preset list, active set, and loading flag are
 * hoisted to module scope so every `useFilterPresetStore()` call returns
 * the SAME reactive data. This is required for cross-component
 * consistency — e.g. `FilterToolbar` calls `loadPresets()` on mount and
 * `ShortlistPanel` (via `useShortlistQuery`) needs to see the same loaded
 * list, not a fresh empty one. Tests that need isolation call
 * `__resetFilterPresetStoreForTest()` in `beforeEach`.
 *
 * **Per-view active set:** only the preset *list* is shared. Which presets
 * are toggled on is kept per scope ('case' vs 'cohort'); a single shared set
 * leaked the case view's active preset chip into the cohort view (and the
 * reverse), so cohort and case filter state were not isolated (P0-3).
 */

import { ref, computed, type Ref } from 'vue'
import type {
  FilterPreset,
  FilterPresetCreate,
  FilterPresetUpdate
} from '../../../shared/types/filter-presets'
import type { FilterState } from '../../../shared/types/filters'
import { useApiService } from './useApiService'
import { unwrapIpcResult } from '../../../shared/types/errors'

// ─── Module-level shared state ────────────────────────────────────────────────
// These refs are intentionally defined outside the composable factory so every
// consumer shares the same list. Without this, `ShortlistPanel` and
// `FilterToolbar` would each instantiate disconnected stores and the shortlist
// preset picker would render empty even after the toolbar finished loading.

export type PresetScope = 'case' | 'cohort'

const presets = ref<FilterPreset[]>([])
const activeByScope: Record<PresetScope, Ref<Set<number>>> = {
  case: ref(new Set<number>()),
  cohort: ref(new Set<number>())
}
const loading = ref(false)
const visiblePresets = computed(() => presets.value.filter((p) => p.isVisible))

// Load dedupe: FilterToolbar, CohortFilterBar and useShortlistQuery each call
// loadPresets() on mount. One in-flight request is shared, and once loaded the
// list is reused until a mutation (or a database switch) invalidates it.
let inFlightLoad: Promise<void> | null = null
let loaded = false

/**
 * Drop the cached preset list so the next loadPresets() refetches. Called on
 * database switch, where the preset table belongs to a different workspace.
 */
export function invalidateFilterPresets(): void {
  loaded = false
  inFlightLoad = null
}

/**
 * Clear all shared preset store state. Exported for use in unit tests that
 * need fresh state between cases — production code must NEVER call this.
 */
export function __resetFilterPresetStoreForTest(): void {
  presets.value = []
  activeByScope.case.value = new Set()
  activeByScope.cohort.value = new Set()
  loading.value = false
  invalidateFilterPresets()
}

export function useFilterPresetStore(scope: PresetScope = 'case') {
  const { api } = useApiService()
  const activePresetIds = activeByScope[scope]

  async function fetchPresets(): Promise<void> {
    if (!api) return
    loading.value = true
    try {
      presets.value = unwrapIpcResult(await api.presets.list())
      loaded = true
    } finally {
      loading.value = false
    }
  }

  /** Load once per session; concurrent callers share the same request. */
  function loadPresets(): Promise<void> {
    if (loaded) return Promise.resolve()
    if (inFlightLoad === null) {
      const request = fetchPresets().finally(() => {
        if (inFlightLoad === request) inFlightLoad = null
      })
      inFlightLoad = request
    }
    return inFlightLoad
  }

  /** Unconditional refetch after this client changed the preset table. */
  async function reloadPresets(): Promise<void> {
    invalidateFilterPresets()
    await loadPresets()
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

  async function savePreset(params: FilterPresetCreate): Promise<FilterPreset | null> {
    if (!api) return null
    const created = unwrapIpcResult(await api.presets.create(params))
    await reloadPresets()
    return created
  }

  async function updatePreset(
    id: number,
    updates: FilterPresetUpdate
  ): Promise<FilterPreset | null> {
    if (!api) return null
    const updated = unwrapIpcResult(await api.presets.update(id, updates))
    await reloadPresets()
    return updated
  }

  async function deletePreset(id: number): Promise<void> {
    if (!api) return
    unwrapIpcResult(await api.presets.delete(id))
    // Reassign Set to trigger Vue reactivity (in-place Set.delete doesn't)
    const newSet = new Set(activePresetIds.value)
    newSet.delete(id)
    activePresetIds.value = newSet
    await reloadPresets()
  }

  async function reorderPresets(items: { id: number; sortOrder: number }[]): Promise<void> {
    if (!api) return
    unwrapIpcResult(await api.presets.reorder(items))
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
