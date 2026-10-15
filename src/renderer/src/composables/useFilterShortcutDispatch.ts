import { unref, type Ref } from 'vue'
import type { AppStateReturn } from './useAppState'
import type { ShortcutActions } from '../config/keyboardShortcuts'

/** Commands both FilterToolbar (case) and CohortFilterBar (cohort) expose. */
export interface FilterCommands {
  focusSearch: () => void
  toggleFilterDrawer: () => void
  toggleColumnsDrawer: () => void
  handleClearAll: () => void
  visiblePresets?:
    Ref<ReadonlyArray<{ id: number; name: string }>> | ReadonlyArray<{ id: number; name: string }>
  togglePreset?: (id: number) => unknown
}

export type FilterShortcutTarget = FilterCommands

type DispatchState = Pick<
  AppStateReturn,
  'activeTab' | 'filterToolbarRef' | 'cohortViewRef' | 'caseShortlistActive'
>

export function activeFilterTarget(state: DispatchState): FilterShortcutTarget | null {
  if (state.activeTab.value === 'cohort') return state.cohortViewRef.value?.filterBar ?? null
  return state.caseShortlistActive.value ? null : state.filterToolbarRef.value
}

export function activeFilterPresets(
  state: DispatchState
): ReadonlyArray<{ id: number; name: string }> {
  return unref(activeFilterTarget(state)?.visiblePresets) ?? []
}

/**
 * Filter shortcut callbacks for `useKeyboardShortcuts`, routed to the filter
 * bar of the visible view. A view without a visible filter bar (case Shortlist,
 * cohort Gene Burden, not yet mounted) gets nothing: a hidden bar is never mutated.
 */
export function filterShortcutCallbacks(
  state: DispatchState
): Required<Pick<ShortcutActions, 'search' | 'toggleFilters' | 'toggleColumns' | 'clearFilters'>> {
  const target = (): FilterCommands | null => activeFilterTarget(state)
  return {
    search: () => target()?.focusSearch(),
    toggleFilters: () => target()?.toggleFilterDrawer(),
    toggleColumns: () => target()?.toggleColumnsDrawer(),
    clearFilters: () => target()?.handleClearAll()
  }
}

export interface PaletteExtraCommandInput {
  appState: DispatchState & Pick<AppStateReturn, 'setActiveTab'>
  cases: ReadonlyArray<{ id: number; name: string; variant_count: number; created_at: number }>
  onShowPreferences: () => void
  onToggleTheme: () => void
  onSelectCase: (id: number, name: string, variantCount: number, createdAt: number) => unknown
}

export function buildPaletteExtraCommands(
  input: PaletteExtraCommandInput
): Array<{ id: string; description: string; action: () => void }> {
  const { appState, cases, onShowPreferences, onToggleTheme, onSelectCase } = input
  const isCase = appState.activeTab.value === 'case'
  return [
    {
      id: 'nav:switch-view',
      description: isCase ? 'Switch to Cohort view' : 'Switch to Case view',
      action: () => appState.setActiveTab(isCase ? 'cohort' : 'case')
    },
    {
      id: 'settings:preferences',
      description: 'Application Preferences',
      action: onShowPreferences
    },
    {
      id: 'settings:toggle-theme',
      description: 'Toggle light / dark theme',
      action: onToggleTheme
    },
    ...activeFilterPresets(appState).map((p) => ({
      id: `preset:${p.id}`,
      description: `Apply preset: ${p.name}`,
      action: () => {
        void activeFilterTarget(appState)?.togglePreset?.(p.id)
      }
    })),
    ...cases.map((c) => ({
      id: `case:${c.id}`,
      description: `Switch case: ${c.name}`,
      action: () => {
        void onSelectCase(c.id, c.name, c.variant_count, c.created_at)
      }
    }))
  ]
}
