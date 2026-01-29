import { useStorage } from '@vueuse/core'
import { computed, type ComputedRef } from 'vue'

/**
 * Filter group preference with id, display order, and active state
 */
export interface FilterGroupPreference {
  /** Filter group ID (e.g., 'search', 'gene', 'impact') */
  id: string
  /** Display order (lower = left) */
  order: number
  /** Whether filter group is expanded/active */
  active: boolean
}

/**
 * Filter preferences container
 */
export interface FilterPreferences {
  groups: FilterGroupPreference[]
}

/**
 * Default filter groups in standard order
 */
const DEFAULT_FILTER_GROUPS: FilterGroupPreference[] = [
  { id: 'search', order: 0, active: true },
  { id: 'gene', order: 1, active: true },
  { id: 'impact', order: 2, active: true },
  { id: 'function', order: 3, active: true },
  { id: 'clinvar', order: 4, active: true },
  { id: 'frequency', order: 5, active: true },
  { id: 'cadd', order: 6, active: true },
  { id: 'tags', order: 7, active: true }
]

/**
 * Composable for managing filter group preferences with localStorage persistence
 */
export function useFilterPreferences() {
  const defaultPrefs: FilterPreferences = {
    groups: DEFAULT_FILTER_GROUPS
  }

  // Reactive localStorage-backed preferences
  const storedPrefs = useStorage<FilterPreferences>(
    'varlens_filter_groups',
    defaultPrefs,
    localStorage,
    { mergeDefaults: true }
  )

  /**
   * Merge stored groups with defaults
   * If stored groups are missing any default IDs (e.g., new filter added),
   * append them at the end with active=true
   */
  const mergeWithDefaults = (): FilterGroupPreference[] => {
    const stored = storedPrefs.value.groups ?? []
    const storedIds = new Set(stored.map((g) => g.id))

    // Find missing default groups
    const missingGroups = DEFAULT_FILTER_GROUPS.filter((g) => !storedIds.has(g.id))

    if (missingGroups.length === 0) {
      return stored
    }

    // Append missing groups with order starting after the max stored order
    const maxOrder = stored.length > 0 ? Math.max(...stored.map((g) => g.order)) : -1
    const mergedMissing = missingGroups.map((g, index) => ({
      ...g,
      order: maxOrder + 1 + index,
      active: true
    }))

    return [...stored, ...mergedMissing]
  }

  /**
   * Filter groups sorted by order
   */
  const filterGroups: ComputedRef<FilterGroupPreference[]> = computed(() => {
    const merged = mergeWithDefaults()
    return merged.slice().sort((a, b) => a.order - b.order)
  })

  /**
   * Reorder filter groups
   * @param ids Array of filter group IDs in desired order
   */
  const setFilterGroupOrder = (ids: string[]): void => {
    const currentGroups = mergeWithDefaults()
    const groupMap = new Map(currentGroups.map((g) => [g.id, g]))

    // Update order based on new ids array
    const reordered = ids
      .map((id, index) => {
        const group = groupMap.get(id)
        if (!group) return null
        return { ...group, order: index }
      })
      .filter((g): g is FilterGroupPreference => g !== null)

    storedPrefs.value.groups = reordered
  }

  /**
   * Toggle filter group active/collapsed state
   * @param id Filter group ID to toggle
   */
  const toggleFilterGroupActive = (id: string): void => {
    const currentGroups = mergeWithDefaults()
    const updated = currentGroups.map((g) => (g.id === id ? { ...g, active: !g.active } : g))
    storedPrefs.value.groups = updated
  }

  /**
   * Reset to default filter group order and all active
   */
  const resetToDefaults = (): void => {
    storedPrefs.value.groups = DEFAULT_FILTER_GROUPS
  }

  return {
    filterGroups,
    setFilterGroupOrder,
    toggleFilterGroupActive,
    resetToDefaults
  }
}
