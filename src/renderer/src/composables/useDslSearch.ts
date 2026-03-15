/**
 * Composable managing the DSL search bar state.
 *
 * Handles mode detection (FTS vs DSL vs @preset), parsing,
 * autocomplete suggestions, and translation to filter structures.
 */

import { ref, computed, watch } from 'vue'
import { parseDsl } from '../dsl/parser'
import { translateAst, type TranslationResult } from '../dsl/translator'
import { getAutocompleteSuggestions, type Suggestion } from '../dsl/autocomplete'
import type { DslParseResult } from '../dsl/types'
import { useDebounceFn } from '@vueuse/core'

export function useDslSearch(presetNames: () => string[]) {
  /** Raw input text in the search bar */
  const rawInput = ref('')

  /** Current parse result (updated on input change) */
  const parseResult = ref<DslParseResult>({
    ast: null,
    isDsl: false,
    ftsQuery: '',
    errors: []
  })

  /** Translation result (DSL → column filters + preset refs) */
  const translationResult = ref<TranslationResult>({
    columnFilters: {},
    presetNames: [],
    warnings: []
  })

  /** Autocomplete suggestions for the dropdown */
  const suggestions = ref<Suggestion[]>([])

  /** Whether the input is valid DSL (no parse errors) */
  const isValid = computed(() => parseResult.value.errors.length === 0)

  /** Whether the input is in DSL mode (contains DSL syntax) */
  const isDslMode = computed(() => parseResult.value.isDsl)

  /** FTS query (only populated when not in DSL mode) */
  const ftsQuery = computed(() => parseResult.value.ftsQuery)

  /** Parse errors for inline display */
  const errors = computed(() => parseResult.value.errors)

  /** Update parse result and suggestions */
  function updateParse(): void {
    const input = rawInput.value.trim()
    parseResult.value = parseDsl(input)

    if (parseResult.value.ast && parseResult.value.errors.length === 0) {
      translationResult.value = translateAst(parseResult.value.ast)
    } else {
      translationResult.value = { columnFilters: {}, presetNames: [], warnings: [] }
    }
  }

  /** Update autocomplete suggestions (called on every keystroke) */
  function updateSuggestions(): void {
    suggestions.value = getAutocompleteSuggestions(rawInput.value, presetNames())
  }

  // Debounce parse (300ms) but update suggestions immediately
  const debouncedParse = useDebounceFn(updateParse, 300)

  watch(rawInput, () => {
    updateSuggestions()
    debouncedParse()
  })

  /** Apply a suggestion from the autocomplete dropdown */
  function applySuggestion(suggestion: Suggestion): void {
    const input = rawInput.value

    if (suggestion.category === 'column') {
      // Replace partial column text with full column name + colon
      const lastSpace = input.lastIndexOf(' ')
      const prefix = lastSpace >= 0 ? input.slice(0, lastSpace + 1) : ''
      rawInput.value = `${prefix}${suggestion.value}:`
    } else if (suggestion.category === 'operator') {
      // Append operator + colon to current input
      const colonIdx = input.lastIndexOf(':')
      rawInput.value = `${input.slice(0, colonIdx + 1)}${suggestion.value}:`
    } else if (suggestion.category === 'value') {
      // Replace partial value
      const lastColonIdx = input.lastIndexOf(':')
      rawInput.value = `${input.slice(0, lastColonIdx + 1)}${suggestion.value} `
    } else if (suggestion.category === 'combinator') {
      rawInput.value = `${input.trim()} ${suggestion.value} `
    } else if (suggestion.category === 'preset') {
      rawInput.value = suggestion.value
    }

    updateSuggestions()
  }

  function clear(): void {
    rawInput.value = ''
    parseResult.value = { ast: null, isDsl: false, ftsQuery: '', errors: [] }
    translationResult.value = { columnFilters: {}, presetNames: [], warnings: [] }
    suggestions.value = []
  }

  return {
    rawInput,
    parseResult,
    translationResult,
    suggestions,
    isValid,
    isDslMode,
    ftsQuery,
    errors,
    applySuggestion,
    clear,
    /** Force an immediate parse (bypass debounce) */
    parseNow: updateParse
  }
}
