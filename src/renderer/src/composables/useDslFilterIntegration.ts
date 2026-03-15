/**
 * Composable that integrates DSL search with filter emission.
 *
 * Encapsulates ALL DSL-to-filter wiring: mode detection, FTS auto-apply,
 * DSL apply-on-Enter, column filter merging, clear, and preset resolution.
 * Used by both FilterToolbar (variant view) and CohortFilterBar (cohort view).
 */

import { ref, watch, computed } from 'vue'
import type { Ref } from 'vue'
import { useDslSearch } from './useDslSearch'
import type { ColumnFilter } from '../../../shared/types/column-filters'

interface DslFilterIntegrationOptions {
  /** Preset names for @preset autocomplete */
  presetNames: () => string[]
  /** Ref to the search query (FTS mode writes here) */
  searchQueryRef: Ref<string>
  /** Called to re-emit filters to the backend */
  emitFilters: () => void
  /** Optional: clear drawer filter fields that conflict with DSL (e.g., maxGnomadAf) */
  clearConflictingDrawerFields?: (columnFilters: Record<string, ColumnFilter>) => void
  /** Optional: resolve @preset references */
  resolvePreset?: (presetName: string) => void
  /** Optional: externally provided ref for DSL column filters (for forward-ref patterns) */
  columnFiltersRef?: Ref<Record<string, ColumnFilter>>
}

export function useDslFilterIntegration(options: DslFilterIntegrationOptions) {
  const { searchQueryRef, emitFilters, clearConflictingDrawerFields, resolvePreset } = options

  // Core DSL composable
  const {
    rawInput: dslInput,
    translationResult: dslTranslation,
    suggestions: dslSuggestions,
    isDslMode,
    ftsQuery,
    errors: dslErrors,
    applySuggestion,
    clear: clearDsl,
    parseNow
  } = useDslSearch(options.presetNames)

  // DSL column filters — merged into emitted filter payload
  // Use externally provided ref if given (for forward-ref patterns), otherwise create one
  const dslColumnFilters = options.columnFiltersRef ?? ref<Record<string, ColumnFilter>>({})

  // Whether DSL column filters are currently active
  const hasDslFilters = computed(() => Object.keys(dslColumnFilters.value).length > 0)

  // FTS mode: auto-apply search on keystroke
  watch(ftsQuery, (query) => {
    if (!isDslMode.value) {
      searchQueryRef.value = query
    }
  })

  /**
   * Apply DSL filters — called ONLY on Enter key (not on every keystroke).
   * This prevents partial expressions like "consequence:=:L" from filtering.
   */
  function applyDslFilters(): void {
    parseNow() // force immediate parse (bypass debounce)
    const translation = dslTranslation.value

    if (isDslMode.value && Object.keys(translation.columnFilters).length > 0) {
      dslColumnFilters.value = { ...translation.columnFilters }

      // Clear drawer equivalents for DSL-filtered columns
      clearConflictingDrawerFields?.(translation.columnFilters)

      // Clear FTS search when in DSL mode
      searchQueryRef.value = ''

      emitFilters()
    } else if (!isDslMode.value && hasDslFilters.value) {
      // Was in DSL mode, now in FTS — clear DSL column filters
      dslColumnFilters.value = {}
      emitFilters()
    }

    // Resolve @preset references
    if (resolvePreset) {
      for (const presetName of translation.presetNames) {
        resolvePreset(presetName)
      }
    }
  }

  /** Clear DSL search bar state and re-emit filters without DSL column filters */
  function handleDslClear(): void {
    clearDsl()
    searchQueryRef.value = ''
    dslColumnFilters.value = {}
    emitFilters()
  }

  /**
   * Merge DSL column filters into an existing column filters map.
   * Call this when building the filter payload for the backend.
   */
  function mergeDslColumnFilters(
    existing?: Record<string, ColumnFilter>
  ): Record<string, ColumnFilter> | undefined {
    if (!hasDslFilters.value && !existing) return undefined
    if (!hasDslFilters.value) return existing
    return { ...(existing ?? {}), ...dslColumnFilters.value }
  }

  return {
    // Reactive state for DslSearchBar component
    dslInput,
    dslSuggestions,
    isDslMode,
    dslErrors,

    // DSL column filters (for merging into filter payloads)
    dslColumnFilters,
    hasDslFilters,

    // Actions
    applyDslFilters,
    handleDslClear,
    applySuggestion,
    mergeDslColumnFilters
  }
}
