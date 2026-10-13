/**
 * Composable that integrates DSL search with filter emission.
 *
 * Encapsulates ALL DSL-to-filter wiring: mode detection, FTS auto-apply,
 * DSL apply-on-Enter, column filter merging, clear, and preset resolution.
 * Used by both FilterToolbar (variant view) and CohortFilterBar (cohort view).
 */

import type { ViewRoute } from './useUrlState'
import { useSearchUrlParam } from './useViewUrlBindings'
import { ref, watch, computed } from 'vue'
import type { Ref } from 'vue'
import { useDslSearch } from './useDslSearch'
import { serializeColumnFilters } from '../dsl/translator'
import type { ColumnFilter } from '../../../shared/types/column-filters'
import type { DslParseError } from '../dsl/types'
import type { SuggestionScope } from '../dsl/autocomplete'
import type { CaseInfoField } from '../../../shared/utils/case-info-fields'

interface DslFilterIntegrationOptions {
  /** Saved presets, referenced in the DSL as `@name` (spaces → `_`, lower case) */
  presets: () => readonly { id: number; name: string }[]
  /** Ref to the search query (FTS mode writes here) */
  searchQueryRef: Ref<string>
  /** Called to re-emit filters to the backend */
  emitFilters: () => void
  /** Optional: clear drawer filter fields that conflict with DSL (e.g., maxGnomadAf) */
  clearConflictingDrawerFields?: (columnFilters: Record<string, ColumnFilter>) => void
  /** Optional: activate a preset referenced as `@name` (no-op if already active) */
  activatePreset?: (presetId: number) => void
  /** Optional: externally provided ref for DSL column filters (for forward-ref patterns) */
  columnFiltersRef?: Ref<Record<string, ColumnFilter>>
  /** Mirror the raw search/DSL text into the URL query (`?q=`) for this view. */
  urlRoute?: ViewRoute
  /** View being filtered; autocomplete offers only its fields (default: case) */
  scope?: SuggestionScope
  /** The open case's `info.<KEY>` fields, offered by autocomplete (case view) */
  infoFields?: () => readonly CaseInfoField[]
}

export function useDslFilterIntegration(options: DslFilterIntegrationOptions) {
  const { searchQueryRef, emitFilters, clearConflictingDrawerFields, activatePreset } = options
  const presetKey = (name: string): string => name.toLowerCase().replace(/\s+/g, '_')
  const findPreset = (key: string) => options.presets().find((p) => presetKey(p.name) === key)

  // Core DSL composable
  const {
    rawInput: dslInput,
    translationResult: dslTranslation,
    suggestions: dslSuggestions,
    isDslMode,
    ftsQuery,
    errors: searchErrors,
    applySuggestion,
    clear: clearDsl,
    parseNow
  } = useDslSearch(
    () => options.presets().map((p) => presetKey(p.name)),
    options.scope,
    options.infoFields
  )

  // Unknown @presets, found on Enter (presets may still be loading while typing)
  const presetErrors = ref<DslParseError[]>([])
  watch(dslInput, () => (presetErrors.value = []))
  const dslErrors = computed(() => [...searchErrors.value, ...presetErrors.value])

  // DSL column filters — merged into emitted filter payload
  // Use externally provided ref if given (for forward-ref patterns), otherwise create one
  const dslColumnFilters = options.columnFiltersRef ?? ref<Record<string, ColumnFilter>>({})

  // Whether DSL column filters are currently active
  const hasDslFilters = computed(() => Object.keys(dslColumnFilters.value).length > 0)

  /**
   * The text whose meaning is fully applied (committed), as opposed to the
   * draft in the bar. Only this is persisted to the URL, so a reload never
   * applies a draft and a rejected draft never replaces the applied query.
   */
  const appliedInput = ref('')

  /**
   * The bar holds a DSL draft (or cleared text over applied DSL) that differs
   * from what produced the current rows. Plain search applies as typed.
   */
  const isDraftPending = computed(
    () => (isDslMode.value || hasDslFilters.value) && dslInput.value.trim() !== appliedInput.value
  )

  // FTS mode: auto-apply search on keystroke. ftsQuery is '' in DSL mode, which
  // drops the term applied while the field name was typed (`gene:` before `gene:=`)
  watch(ftsQuery, (query) => {
    searchQueryRef.value = query
    // With DSL filters still active the plain text is only half applied (until Enter)
    if (!hasDslFilters.value) appliedInput.value = query
  })

  /**
   * Apply DSL filters — called ONLY on Enter key (not on every keystroke).
   * This prevents partial expressions like "consequence:=:L" from filtering.
   *
   * Atomic: an invalid or unsupported expression changes nothing — the
   * previous query, drawer fields and presets stay as they are and the
   * errors stay visible in the bar. URL restores skip preset resolution: the
   * `f` snapshot already holds the preset's values, possibly edited since.
   */
  function applyDslFilters(resolvePresets = true): void {
    parseNow() // force immediate parse (bypass debounce)
    const translation = dslTranslation.value
    if (activatePreset && resolvePresets) {
      presetErrors.value = translation.presetNames
        .filter((name) => findPreset(name) === undefined)
        .map((name) => ({ message: `Unknown preset @${name}`, position: 0, length: 1 }))
    }
    if (dslErrors.value.length > 0) return

    if (isDslMode.value) {
      dslColumnFilters.value = { ...translation.columnFilters }
      // Clear drawer equivalents for DSL-filtered columns
      clearConflictingDrawerFields?.(translation.columnFilters)
      // Clear FTS search when in DSL mode
      searchQueryRef.value = ''
      appliedInput.value = dslInput.value.trim()
      emitFilters()
    } else {
      appliedInput.value = ftsQuery.value
      if (hasDslFilters.value) {
        // Was in DSL mode, now in FTS — clear DSL column filters
        dslColumnFilters.value = {}
        emitFilters()
      }
    }

    if (activatePreset && resolvePresets) {
      for (const name of translation.presetNames) activatePreset(findPreset(name)!.id)
    }
  }

  /** Clear DSL search bar state and re-emit filters without DSL column filters */
  function handleDslClear(): void {
    clearDsl()
    searchQueryRef.value = ''
    dslColumnFilters.value = {}
    appliedInput.value = ''
    emitFilters()
  }

  /**
   * Remove one applied DSL condition (chip close). The bar and the committed
   * text are rewritten from the remaining conditions, so `?q=`, reload and
   * history cannot bring the removed condition back.
   */
  function removeDslCondition(column: string): void {
    const rest = { ...dslColumnFilters.value }
    delete rest[column]
    dslColumnFilters.value = rest
    const text = serializeColumnFilters(rest)
    dslInput.value = text
    parseNow()
    appliedInput.value = text
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

  if (options.urlRoute !== undefined) {
    useSearchUrlParam(options.urlRoute, appliedInput, (value) => {
      dslInput.value = value
      applyDslFilters(false)
    })
  }

  return {
    // Reactive state for DslSearchBar component
    dslInput,
    dslSuggestions,
    isDslMode,
    dslErrors,
    isDraftPending,

    // DSL column filters (for merging into filter payloads)
    dslColumnFilters,
    hasDslFilters,

    // Actions
    applyDslFilters,
    handleDslClear,
    removeDslCondition,
    applySuggestion,
    mergeDslColumnFilters
  }
}
