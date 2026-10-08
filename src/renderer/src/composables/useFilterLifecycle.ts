/**
 * Composable for filter lifecycle management
 *
 * Handles case-switch watching, filter reset on case change,
 * and initial search setup. Extracted from useFilterState for modularity.
 */

import { watch, type Ref, type ComputedRef } from 'vue'
import type { VariantFilter } from '../../../shared/types/api'
import type { FilterState } from '../../../shared/types/filters'
import { resetAdapterFields } from './filter-types'

/**
 * Options for useFilterLifecycle
 */
export interface UseFilterLifecycleOptions {
  /** Reactive ref to the current case ID */
  caseIdRef: Ref<number> | ComputedRef<number>
  /** Reactive filter state */
  filters: Ref<FilterState>
  /** Reset presets to defaults */
  resetPresets: () => void
  /** Callback when filters update */
  onFiltersUpdate: (filters: Omit<VariantFilter, 'case_id'>) => void
  /** Callback when case switches */
  onCaseSwitch?: () => void
  /** Load filter options for a case */
  loadFilterOptions: () => Promise<void>
  /**
   * Optional visibility gate (Sprint A A3 / Pass-9 #3). When provided and
   * `false`, the case-switch watcher resets filter state but does NOT fire
   * `loadFilterOptions` — deferring the IPC round-trip until the toolbar is
   * actually shown. Defaults to always-visible when omitted.
   */
  visibleRef?: Ref<boolean>
}

/**
 * Return type for useFilterLifecycle composable
 */
export interface UseFilterLifecycleReturn {
  /** Reset all filters for a case switch (without sort reset) */
  resetForCaseSwitch: () => void
  /** Set initial search query (e.g., from cohort navigation) */
  setInitialSearch: (search: string) => void
}

/**
 * Composable for filter lifecycle management
 *
 * Sets up the case-switch watcher, provides reset and initial search helpers.
 *
 * @param options - Lifecycle dependencies
 * @returns Lifecycle methods
 */
export function useFilterLifecycle(options: UseFilterLifecycleOptions): UseFilterLifecycleReturn {
  const {
    caseIdRef,
    filters,
    resetPresets,
    onFiltersUpdate,
    onCaseSwitch,
    loadFilterOptions,
    visibleRef
  } = options

  /**
   * Reset all filters for a case switch (without triggering sort reset)
   */
  const resetForCaseSwitch = (): void => {
    resetAdapterFields(filters)
    resetPresets()
  }

  // Watch caseId prop and reset filters when case changes
  watch(caseIdRef, async (newCaseId, oldCaseId) => {
    if (newCaseId !== oldCaseId && oldCaseId !== undefined) {
      // Reset all filters when switching cases
      resetForCaseSwitch()

      // Notify parent to clear UI-only state (DSL column filters, etc.)
      onCaseSwitch?.()

      // Emit reset filters immediately (bypass debounce for case switch)
      onFiltersUpdate({})

      // Reload filter options for the new case — gated on visibility so a
      // hidden/deferred toolbar does not fire the IPC until it is shown.
      if (visibleRef === undefined || visibleRef.value) {
        await loadFilterOptions()
      }
    }
  })

  /**
   * Set initial search query (e.g., from cohort navigation)
   */
  const setInitialSearch = (search: string): void => {
    if (search !== undefined && search !== '') {
      filters.value.searchQuery = search
    }
  }

  return {
    resetForCaseSwitch,
    setInitialSearch
  }
}
