import { useStorage } from '@vueuse/core'
import { computed, type ComputedRef } from 'vue'

/**
 * Filter group preference with id, display order, visibility, and expanded state
 */
export interface FilterGroupPreference {
  /** Filter group ID (e.g., 'search', 'gene', 'impact') */
  id: string
  /** Display order (lower = left) */
  order: number
  /** Whether filter group is visible in toolbar */
  visible: boolean
  /** Whether filter group content is expanded (false = collapsed, shows only header) */
  expanded: boolean
}

/**
 * Filter preferences container
 */
export interface FilterPreferences {
  groups: FilterGroupPreference[]
}

/**
 * Default filter groups for case analysis (standard order)
 */
const DEFAULT_CASE_FILTER_GROUPS: FilterGroupPreference[] = [
  { id: 'impact', order: 0, visible: true, expanded: true },
  { id: 'clinvar', order: 1, visible: true, expanded: true },
  { id: 'frequency', order: 2, visible: true, expanded: true },
  { id: 'search', order: 3, visible: true, expanded: true },
  { id: 'function', order: 4, visible: true, expanded: true },
  { id: 'gene', order: 5, visible: true, expanded: true },
  { id: 'cadd', order: 6, visible: true, expanded: true },
  { id: 'tags', order: 7, visible: true, expanded: true },
  { id: 'annotations', order: 8, visible: true, expanded: true }
]

/**
 * Default filter groups for cohort analysis
 */
export const DEFAULT_COHORT_FILTER_GROUPS: FilterGroupPreference[] = [
  { id: 'search', order: 0, visible: true, expanded: true },
  { id: 'gene', order: 1, visible: true, expanded: true },
  { id: 'impact', order: 2, visible: true, expanded: true },
  { id: 'function', order: 3, visible: true, expanded: true },
  { id: 'clinvar', order: 4, visible: true, expanded: true },
  { id: 'cohort-freq', order: 5, visible: true, expanded: true },
  { id: 'frequency', order: 6, visible: true, expanded: true },
  { id: 'cadd', order: 7, visible: true, expanded: true }
]

/**
 * Options for configuring filter preferences
 */
export interface UseFilterPreferencesOptions {
  /** Storage key for localStorage. Defaults to 'varlens_filter_groups_v2' */
  storageKey?: string
  /** Default filter groups. Defaults to case analysis groups */
  defaultGroups?: FilterGroupPreference[]
}

/**
 * Composable for managing filter group preferences with localStorage persistence
 *
 * @param options Optional configuration for storage key and default groups
 */
export function useFilterPreferences(options?: UseFilterPreferencesOptions) {
  const storageKey = options?.storageKey ?? 'varlens_filter_groups_v2'
  const defaultFilterGroups = options?.defaultGroups ?? DEFAULT_CASE_FILTER_GROUPS

  const defaultPrefs: FilterPreferences = {
    groups: defaultFilterGroups
  }

  // Reactive localStorage-backed preferences
  const storedPrefs = useStorage<FilterPreferences>(storageKey, defaultPrefs, localStorage, {
    mergeDefaults: true
  })

  /**
   * Merged filter groups — computed once per storedPrefs change.
   * Merges stored groups with defaults, migrating old 'active' field to
   * new 'visible'+'expanded' fields, and appending any newly-added defaults.
   */
  const mergedGroups: ComputedRef<FilterGroupPreference[]> = computed(() => {
    const stored = storedPrefs.value.groups ?? []
    const storedIds = new Set(stored.map((g) => g.id))

    // Migrate old format (active) to new format (visible + expanded)
    const migrated = stored.map((g) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyG = g as any
      if (anyG.active !== undefined && g.visible === undefined) {
        return {
          id: g.id,
          order: g.order,
          visible: anyG.active,
          expanded: anyG.active
        }
      }
      return {
        id: g.id,
        order: g.order,
        visible: g.visible ?? true,
        expanded: g.expanded ?? true
      }
    })

    // Find missing default groups
    const missingGroups = defaultFilterGroups.filter((g) => !storedIds.has(g.id))

    if (missingGroups.length === 0) {
      return migrated
    }

    // Append missing groups with order starting after the max stored order
    const maxOrder = migrated.length > 0 ? Math.max(...migrated.map((g) => g.order)) : -1
    const mergedMissing = missingGroups.map((g, index) => ({
      ...g,
      order: maxOrder + 1 + index,
      visible: true,
      expanded: true
    }))

    return [...migrated, ...mergedMissing]
  })

  /**
   * All filter groups sorted by order (for menu)
   */
  const filterGroups: ComputedRef<FilterGroupPreference[]> = computed(() => {
    return mergedGroups.value.slice().sort((a, b) => a.order - b.order)
  })

  /**
   * Visible filter groups sorted by order (for toolbar display)
   */
  const visibleFilterGroups: ComputedRef<FilterGroupPreference[]> = computed(() => {
    return filterGroups.value.filter((g) => g.visible)
  })

  /**
   * Reorder filter groups
   * @param ids Array of filter group IDs in desired order
   */
  const setFilterGroupOrder = (ids: string[]): void => {
    const currentGroups = mergedGroups.value
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
   * Toggle filter group expanded/collapsed state
   * @param id Filter group ID to toggle
   */
  const toggleFilterGroupExpanded = (id: string): void => {
    const currentGroups = mergedGroups.value
    const updated = currentGroups.map((g) => (g.id === id ? { ...g, expanded: !g.expanded } : g))
    storedPrefs.value.groups = updated
  }

  /**
   * Toggle filter group visibility (show/hide)
   * @param id Filter group ID to toggle
   */
  const toggleFilterGroupVisible = (id: string): void => {
    const currentGroups = mergedGroups.value
    const updated = currentGroups.map((g) => (g.id === id ? { ...g, visible: !g.visible } : g))
    storedPrefs.value.groups = updated
  }

  /**
   * Hide a filter group (set visible to false)
   * @param id Filter group ID to hide
   */
  const hideFilterGroup = (id: string): void => {
    const currentGroups = mergedGroups.value
    const updated = currentGroups.map((g) => (g.id === id ? { ...g, visible: false } : g))
    storedPrefs.value.groups = updated
  }

  /**
   * Reset to default filter group order and all visible/expanded
   */
  const resetToDefaults = (): void => {
    storedPrefs.value.groups = defaultFilterGroups
  }

  /**
   * Show all filter groups (set all to visible and expanded)
   */
  const showAll = (): void => {
    const currentGroups = mergedGroups.value
    const updated = currentGroups.map((g) => ({ ...g, visible: true, expanded: true }))
    storedPrefs.value.groups = updated
  }

  return {
    filterGroups,
    visibleFilterGroups,
    setFilterGroupOrder,
    toggleFilterGroupExpanded,
    toggleFilterGroupVisible,
    hideFilterGroup,
    resetToDefaults,
    showAll
  }
}
