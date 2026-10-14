import type { AppStateReturn } from './useAppState'
import type { ShortcutActions } from '../config/keyboardShortcuts'

/** Commands both FilterToolbar (case) and CohortFilterBar (cohort) expose. */
export interface FilterCommands {
  focusSearch: () => void
  toggleFilterDrawer: () => void
  toggleColumnsDrawer: () => void
  handleClearAll: () => void
}

type DispatchState = Pick<
  AppStateReturn,
  'activeTab' | 'filterToolbarRef' | 'cohortViewRef' | 'caseShortlistActive'
>

/**
 * Filter shortcut callbacks for `useKeyboardShortcuts`, routed to the filter
 * bar of the visible view. A view without a visible filter bar (case Shortlist,
 * cohort Gene Burden, not yet mounted) gets nothing: a hidden bar is never mutated.
 */
export function filterShortcutCallbacks(
  state: DispatchState
): Required<Pick<ShortcutActions, 'search' | 'toggleFilters' | 'toggleColumns' | 'clearFilters'>> {
  const target = (): FilterCommands | null => {
    if (state.activeTab.value === 'cohort') return state.cohortViewRef.value?.filterBar ?? null
    return state.caseShortlistActive.value ? null : state.filterToolbarRef.value
  }
  return {
    search: () => target()?.focusSearch(),
    toggleFilters: () => target()?.toggleFilterDrawer(),
    toggleColumns: () => target()?.toggleColumnsDrawer(),
    clearFilters: () => target()?.handleClearAll()
  }
}
