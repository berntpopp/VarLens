import { useStorage } from '@vueuse/core'
import type { Ref } from 'vue'

/**
 * Column preferences stored per table
 */
export interface ColumnPreferences {
  /** Column keys in user's preferred order (empty = default) */
  order: string[]
  /** Column key -> visible (missing = visible by default) */
  visibility: Record<string, boolean>
  /** Column key -> width in pixels (missing = default) */
  widths: Record<string, number>
}

const MIN_WIDTH = 60
const MAX_WIDTH = 500

/**
 * Composable for managing column preferences with localStorage persistence
 * @param tableId Unique identifier for the table (e.g., 'variants', 'cohort')
 */
export function useColumnPreferences(tableId: string) {
  const defaultPrefs: ColumnPreferences = {
    order: [],
    visibility: {},
    widths: {}
  }

  // Reactive localStorage-backed preferences
  // mergeDefaults: true ensures new properties are added when schema evolves
  const prefs: Ref<ColumnPreferences> = useStorage(
    `varlens_columns_${tableId}`,
    defaultPrefs,
    localStorage,
    { mergeDefaults: true }
  )

  /**
   * Reset all preferences to defaults
   */
  const resetToDefaults = (): void => {
    prefs.value = {
      order: [],
      visibility: {},
      widths: {}
    }
  }

  /**
   * Update column order
   * @param keys Array of column keys in desired order
   */
  const setColumnOrder = (keys: string[]): void => {
    prefs.value.order = keys
  }

  /**
   * Toggle column visibility
   * @param key Column key to toggle
   */
  const toggleColumnVisibility = (key: string): void => {
    const currentVisibility = prefs.value.visibility[key] ?? true
    prefs.value.visibility = {
      ...prefs.value.visibility,
      [key]: !currentVisibility
    }
  }

  /**
   * Set column width with min/max clamping
   * @param key Column key
   * @param width Desired width in pixels
   */
  const setColumnWidth = (key: string, width: number): void => {
    const clampedWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))
    prefs.value.widths = {
      ...prefs.value.widths,
      [key]: clampedWidth
    }
  }

  return {
    prefs,
    resetToDefaults,
    setColumnOrder,
    toggleColumnVisibility,
    setColumnWidth
  }
}
