/**
 * Ready-made URL bindings for the case and cohort views (see useUrlState).
 * Each helper is a one-line call at the state owner, keeping the large
 * view components free of URL plumbing. Case and cohort use the same
 * helpers (cohort parity): filters `f`, search `q`, sort `sort`.
 */
import { nextTick, watch, type Ref } from 'vue'
import type { AppStateReturn } from './useAppState'
import { useUrlParam, type ViewRoute } from './useUrlState'
import { useApiService } from './useApiService'
import { logService } from '../services/LogService'
import { formatError } from '../utils/ipc-result'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { createFilterState } from '../../../shared/filters/filterDefaults'
import type { FilterState } from '../../../shared/types/filters'
import {
  decodeFilterSnapshot,
  decodeSort,
  encodeFilterSnapshot,
  encodeSort,
  parsePositiveInt,
  parseVisibleTab,
  type SortKey
} from '../utils/url-state/view-query'
import type { PerTypeTab, VisibleTab } from '../../../shared/types/shortlist'

/** `?case=<id>` — selected case; a history step (back returns to the previous case). */
export function useCaseUrlParam(appState: AppStateReturn): void {
  const { api } = useApiService()
  useUrlParam({
    route: 'case',
    key: 'case',
    priority: 0,
    history: 'push',
    read: () =>
      appState.selectedCaseId.value === null ? undefined : String(appState.selectedCaseId.value),
    apply: async (value) => {
      const id = parsePositiveInt(value)
      if (id === null) {
        appState.clearSelectedCase()
        return
      }
      if (!api) return
      try {
        const match = unwrapIpcResult(await api.cases.list()).find((c) => c.id === id)
        if (match === undefined) {
          appState.clearSelectedCase()
          appState.showSnack(`Case ${id} from the link was not found.`, 'warning')
          return
        }
        appState.selectCase({
          caseId: match.id,
          caseName: match.name,
          variantCount: match.variant_count,
          createdAt: match.created_at
        })
      } catch (e) {
        logService.error('Restoring case from URL failed: ' + formatError(e), 'url-state')
      }
    }
  })
}

/** `?f=` — drawer/preset filter state diff + impact chips. */
export function useFilterUrlParam(
  route: ViewRoute,
  filters: Ref<FilterState>,
  impactPresets: Ref<string[]>
): void {
  useUrlParam({
    route,
    key: 'f',
    priority: 2,
    history: 'replace',
    read: () => encodeFilterSnapshot(filters.value, impactPresets.value),
    apply: (value) => {
      const { state, impact } = decodeFilterSnapshot(value)
      // Search text is owned by the `q` binding; keep it across filter restores.
      filters.value = createFilterState({ ...state, searchQuery: filters.value.searchQuery })
      impactPresets.value = impact
    }
  })
}

/** `?q=` — raw search / DSL text; applied like pressing Enter in the bar. */
export function useSearchUrlParam(
  route: ViewRoute,
  input: Ref<string>,
  applyInput: () => void
): void {
  useUrlParam({
    route,
    key: 'q',
    priority: 3,
    history: 'replace',
    read: () => (input.value.trim() === '' ? undefined : input.value),
    apply: (value) => {
      input.value = value ?? ''
      applyInput()
    }
  })
}

/** `?sort=` — sort keys only; evaluation (e.g. chromosome order) stays server-side. */
export function useSortUrlParam(
  route: ViewRoute,
  sortBy: Ref<Array<{ key: string; order: boolean | 'asc' | 'desc' }>>
): void {
  useUrlParam({
    route,
    key: 'sort',
    priority: 4,
    history: 'replace',
    read: () =>
      encodeSort(
        sortBy.value.map((s): SortKey => ({
          key: s.key,
          order: s.order === 'desc' || s.order === false ? 'desc' : 'asc'
        }))
      ),
    apply: (value) => {
      sortBy.value = decodeSort(value)
    }
  })
}

/**
 * `?tab=` — case variant-type tab (a history step). While type counts load
 * the requested tab is parked and handed to CaseView's default-selection
 * rule via `consumePendingTab`, so the URL beats the "default tab" setting.
 */
export function useCaseTabUrlParam(options: {
  selectedCaseId: Ref<number | null>
  selectedVariantType: Ref<VisibleTab>
  countsLoading: Ref<boolean>
  availableTabs: () => VisibleTab[]
}): { consumePendingTab: (presentTypes: PerTypeTab[]) => VisibleTab | null } {
  const { selectedCaseId, selectedVariantType, countsLoading, availableTabs } = options
  let pendingTab: VisibleTab | null = null
  // The tab chosen automatically after a case switch belongs to the case's
  // history entry (replace); only user tab clicks create a new entry (push).
  let autoSelecting = false
  watch(selectedCaseId, () => {
    autoSelecting = true
  })
  watch(countsLoading, (loading) => {
    if (!loading) void nextTick(() => (autoSelecting = false))
  })

  useUrlParam({
    route: 'case',
    key: 'tab',
    priority: 1,
    history: () => (autoSelecting ? 'replace' : 'push'),
    read: () =>
      selectedCaseId.value === null
        ? undefined
        : countsLoading.value
          ? null
          : selectedVariantType.value,
    apply: (value) => {
      const tab = parseVisibleTab(value)
      if (tab === null) return
      if (!countsLoading.value && availableTabs().includes(tab)) selectedVariantType.value = tab
      else pendingTab = tab
    }
  })

  return {
    consumePendingTab(presentTypes) {
      const requested = pendingTab
      pendingTab = null
      if (requested === null || presentTypes.length === 0) return null
      return requested === 'shortlist' || presentTypes.includes(requested) ? requested : null
    }
  }
}
