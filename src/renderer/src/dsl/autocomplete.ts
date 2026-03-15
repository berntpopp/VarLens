/**
 * Context-aware autocomplete for the filter DSL search bar.
 *
 * Analyzes the current input to determine what state the user is in
 * (typing column, operator, value, or combinator) and returns relevant
 * suggestions. Limits to 10 suggestions max.
 */

import {
  FILTER_COLUMNS,
  findColumn,
  getColumnSuggestions,
  getCommonValues
} from './column-registry'

const MAX_SUGGESTIONS = 10

export type SuggestionCategory = 'column' | 'operator' | 'value' | 'combinator' | 'preset' | 'hint'

export interface Suggestion {
  /** Value to insert when selected */
  value: string
  /** Display label */
  label: string
  /** Optional description shown as secondary text */
  description?: string
  /** Category for grouping in the dropdown */
  category: SuggestionCategory
  /** Optional icon */
  icon?: string
  /** Column type badge (shown for column suggestions) */
  typeBadge?: string
}

/** Operator display names */
const OPERATOR_LABELS: Record<string, string> = {
  '=': 'Equals',
  '!=': 'Not equals',
  '<': 'Less than',
  '>': 'Greater than',
  '<=': 'Less than or equal',
  '>=': 'Greater than or equal',
  '~': 'Contains',
  '!~': 'Does not contain',
  '^': 'Starts with',
  $: 'Ends with',
  'is:null': 'Is empty/missing',
  'is:notnull': 'Has value'
}

type AutocompleteState = 'empty' | 'column' | 'operator' | 'value' | 'combinator' | 'preset'

interface ParsedContext {
  state: AutocompleteState
  /** Column key if we're past the column part */
  column?: string
  /** Operator if we're past the operator part */
  operator?: string
  /** Partial text the user is currently typing */
  partial: string
}

/**
 * Determine the autocomplete state from the current input.
 */
function detectState(input: string): ParsedContext {
  const trimmed = input.trimStart()

  if (trimmed === '') {
    return { state: 'empty', partial: '' }
  }

  // Preset mode
  if (trimmed.startsWith('@')) {
    return { state: 'preset', partial: trimmed.slice(1) }
  }

  // Look at the last "term" in the input (after the last combinator)
  const lastCombinatorIdx = Math.max(input.lastIndexOf(' AND '), input.lastIndexOf(' OR '))
  const lastTerm =
    lastCombinatorIdx >= 0 ? input.slice(lastCombinatorIdx).replace(/^\s*(AND|OR)\s*/, '') : trimmed

  // Count colons to determine state
  const parts = lastTerm.split(':')

  if (parts.length === 1) {
    // No colon yet — typing column name
    // But if input ends with space after a complete expression, suggest combinators
    if (input.endsWith(' ') && lastCombinatorIdx < 0 && /\w+:[^:]+:[^\s]+/.test(trimmed)) {
      return { state: 'combinator', partial: '' }
    }
    if (input.endsWith(' ') && lastCombinatorIdx >= 0 && lastTerm.trim() === '') {
      return { state: 'column', partial: '' }
    }
    return { state: 'column', partial: parts[0] }
  }

  const column = parts[0]

  if (parts.length === 2) {
    // One colon: column: — suggest operators
    // Check if this might be is:null/is:notnull
    if (parts[1].toLowerCase() === 'is') {
      return { state: 'operator', column, partial: 'is' }
    }
    return { state: 'operator', column, partial: parts[1] }
  }

  if (parts.length >= 3) {
    // Two+ colons: column:op: — suggest values
    const operator = parts[1]
    const valuePart = parts.slice(2).join(':')

    // If the expression looks complete and ends with space
    if (valuePart !== '' && input.endsWith(' ')) {
      return { state: 'combinator', partial: '' }
    }

    return { state: 'value', column, operator, partial: valuePart }
  }

  return { state: 'column', partial: trimmed }
}

/**
 * Get autocomplete suggestions based on current input.
 *
 * @param input - Current text in the search bar
 * @param presetNames - Available preset names (from preset store)
 * @returns Suggestions sorted by relevance, limited to MAX_SUGGESTIONS
 */
export function getAutocompleteSuggestions(
  input: string,
  presetNames: string[] = []
): Suggestion[] {
  const ctx = detectState(input)

  switch (ctx.state) {
    case 'empty': {
      const hint: Suggestion = {
        value: '',
        label: 'Type column name to filter, or plain text to search',
        category: 'hint',
        description: 'e.g. gnomad_af:<:0.01 or BRCA1'
      }
      const cols: Suggestion[] = FILTER_COLUMNS.slice(0, MAX_SUGGESTIONS - 1).map((col) => ({
        value: col.key,
        label: col.key,
        description: col.label,
        category: 'column' as SuggestionCategory,
        typeBadge: col.type
      }))
      return [hint, ...cols].slice(0, MAX_SUGGESTIONS)
    }

    case 'column': {
      const matching = getColumnSuggestions(ctx.partial)
      return matching.slice(0, MAX_SUGGESTIONS).map((col) => ({
        value: col.key,
        label: col.key,
        description: col.label,
        category: 'column' as SuggestionCategory,
        typeBadge: col.type
      }))
    }

    case 'operator': {
      const colDef = findColumn(ctx.column ?? '')
      if (!colDef) return []
      return colDef.operators
        .filter((op) => ctx.partial === '' || op.startsWith(ctx.partial))
        .slice(0, MAX_SUGGESTIONS)
        .map((op) => ({
          value: op,
          label: op,
          description: OPERATOR_LABELS[op] ?? op,
          category: 'operator' as SuggestionCategory
        }))
    }

    case 'value': {
      const colDef = findColumn(ctx.column ?? '')
      if (!colDef) return []
      const common = getCommonValues(colDef.key)
      return common
        .filter((cv) => ctx.partial === '' || String(cv.value).startsWith(ctx.partial))
        .slice(0, MAX_SUGGESTIONS)
        .map((cv) => ({
          value: String(cv.value),
          label: String(cv.value),
          description: cv.label,
          category: 'value' as SuggestionCategory
        }))
    }

    case 'combinator':
      return [
        {
          value: 'AND',
          label: 'AND',
          description: 'All conditions must match',
          category: 'combinator'
        },
        {
          value: 'OR',
          label: 'OR',
          description: 'Any condition can match',
          category: 'combinator'
        }
      ]

    case 'preset': {
      const matching = presetNames.filter(
        (n) => ctx.partial === '' || n.toLowerCase().startsWith(ctx.partial.toLowerCase())
      )
      return matching.slice(0, MAX_SUGGESTIONS).map((name) => ({
        value: `@${name}`,
        label: `@${name}`,
        description: 'Apply preset',
        category: 'preset' as SuggestionCategory,
        icon: 'mdi-filter-variant'
      }))
    }

    default:
      return []
  }
}
