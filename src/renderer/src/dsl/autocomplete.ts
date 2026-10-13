/**
 * Context-aware autocomplete for the filter DSL search bar.
 *
 * Analyzes the current input to determine what state the user is in
 * (typing column, operator, value, or combinator) and returns relevant
 * suggestions. Limits to 10 suggestions max.
 */

import { mdiFilterVariant } from '@mdi/js'
import { INFO_FIELD_PREFIX } from '../../../shared/filters/info-field-filter'
import type { CaseInfoField } from '../../../shared/utils/case-info-fields'
import {
  COHORT_ONLY_COLUMNS,
  INFO_FIELD_OPERATORS,
  findColumn,
  getColumnSuggestions,
  getCommonValues,
  isColumnInScope,
  type FilterColumnDef,
  type FilterScope
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

/** Which view the query filters: the cohort summary holds no per-case fields. */
export type SuggestionScope = FilterScope

function fieldsMatching(partial: string, scope: SuggestionScope): FilterColumnDef[] {
  if (scope === 'case') return getColumnSuggestions(partial)
  const lower = partial.toLowerCase()
  const cohortOnly = COHORT_ONLY_COLUMNS.filter(
    (col) => col.key.startsWith(lower) || col.label.toLowerCase().startsWith(lower)
  )
  return [...getColumnSuggestions(partial, scope), ...cohortOnly]
}

/** The case's `info.<KEY>` fields matching a typed prefix (of `info.KEY` or of the key). */
function infoFieldsMatching(partial: string, infoFields: readonly CaseInfoField[]): Suggestion[] {
  const lower = partial.toLowerCase()
  if (lower === '') return []
  return infoFields
    .filter(
      ({ key }) =>
        `${INFO_FIELD_PREFIX}${key}`.toLowerCase().startsWith(lower) ||
        key.toLowerCase().startsWith(lower)
    )
    .map(({ key, source }) => ({
      value: `${INFO_FIELD_PREFIX}${key}`,
      label: `${INFO_FIELD_PREFIX}${key}`,
      description: source,
      category: 'column',
      typeBadge: 'info'
    }))
}

/** Why an `info.<KEY>` filter cannot match on this case; null when it can or nothing is known. */
function unavailableInfoHint(
  name: string,
  infoFields: readonly CaseInfoField[]
): Suggestion | null {
  const key = name.slice(INFO_FIELD_PREFIX.length)
  if (infoFields.length === 0 || infoFields.some((f) => f.key === key)) return null
  return {
    value: '',
    label: `${key} is not an imported field of this case: only is:null matches`,
    category: 'hint',
    description: 'The field may exist on another case or was not kept at import'
  }
}

const isInfoColumn = (name: string): boolean => name.toLowerCase().startsWith(INFO_FIELD_PREFIX)

function resolveField(name: string, scope: SuggestionScope): FilterColumnDef | undefined {
  const col = findColumn(name)
  if (col) return isColumnInScope(col, scope) ? col : undefined
  return scope === 'cohort'
    ? COHORT_ONLY_COLUMNS.find((c) => c.key === name.toLowerCase())
    : undefined
}

const RANGE_OPERATORS = new Set(['<', '>', '<=', '>='])

/** Operator label plus what happens to variants that have no value for the field. */
function operatorDescription(op: string, col: FilterColumnDef): string {
  const label = OPERATOR_LABELS[op] ?? op
  if (col.type === 'numeric' && RANGE_OPERATORS.has(op)) {
    return `${label} — also keeps variants with no ${col.label} value`
  }
  if (op === '!=') return `${label} — variants with no ${col.label} value never match`
  return label
}

function fieldSuggestion(col: FilterColumnDef): Suggestion {
  return {
    value: col.key,
    label: col.key,
    description: col.label,
    category: 'column',
    typeBadge: col.type
  }
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
 * @param scope - The view being filtered; only its fields are offered
 * @param infoFields - The open case's `info.<KEY>` fields (case view only)
 * @returns Suggestions sorted by relevance. Every in-scope field is listed so a
 *   query can be built by picking alone; other lists stop at MAX_SUGGESTIONS.
 */
export function getAutocompleteSuggestions(
  input: string,
  presetNames: string[] = [],
  scope: SuggestionScope = 'case',
  infoFields: readonly CaseInfoField[] = []
): Suggestion[] {
  const ctx = detectState(input)
  const caseInfo = scope === 'case' ? infoFields : []
  const column = ctx.column ?? ''
  if (scope === 'case' && isInfoColumn(column)) {
    // The parser takes the prefix in any case; the key keeps its case.
    return infoSuggestions(
      ctx,
      INFO_FIELD_PREFIX + column.slice(INFO_FIELD_PREFIX.length),
      caseInfo
    )
  }

  switch (ctx.state) {
    case 'empty': {
      const hint: Suggestion = {
        value: '',
        label: 'Pick a field to build a filter, or type text to search',
        category: 'hint',
        description: 'e.g. gnomad_af:<:0.01 or BRCA1'
      }
      return [hint, ...fieldsMatching('', scope).map(fieldSuggestion)]
    }

    case 'column':
      return [
        ...fieldsMatching(ctx.partial, scope).map(fieldSuggestion),
        ...infoFieldsMatching(ctx.partial, caseInfo)
      ]

    case 'operator': {
      const colDef = resolveField(ctx.column ?? '', scope)
      if (!colDef) return []
      return colDef.operators
        .filter((op) => ctx.partial === '' || op.startsWith(ctx.partial))
        .slice(0, MAX_SUGGESTIONS)
        .map((op) => ({
          value: op,
          label: op,
          description: operatorDescription(op, colDef),
          category: 'operator' as SuggestionCategory
        }))
    }

    case 'value': {
      const colDef = resolveField(ctx.column ?? '', scope)
      if (!colDef) return []
      const values = getCommonValues(colDef.key)
        .filter((cv) => ctx.partial === '' || String(cv.value).startsWith(ctx.partial))
        .slice(0, MAX_SUGGESTIONS)
        .map((cv) => ({
          value: String(cv.value),
          label: String(cv.value),
          description: cv.label,
          category: 'value' as SuggestionCategory
        }))
      if (values.length > 0 || ctx.partial !== '') return values
      return [
        {
          value: '',
          label: `Type a ${colDef.type === 'numeric' ? 'number' : 'value'} for ${colDef.label}, then press Enter`,
          category: 'hint'
        }
      ]
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
        icon: mdiFilterVariant
      }))
    }

    default:
      return []
  }
}

/** Operator or value suggestions for an `info.<KEY>` field, after any availability hint. */
function infoSuggestions(
  ctx: ParsedContext,
  name: string,
  infoFields: readonly CaseInfoField[]
): Suggestion[] {
  const hint = unavailableInfoHint(name, infoFields)
  const rest: Suggestion[] =
    ctx.state === 'operator'
      ? INFO_FIELD_OPERATORS.filter((op) => ctx.partial === '' || op.startsWith(ctx.partial)).map(
          (op) => ({
            value: op,
            label: op,
            description: OPERATOR_LABELS[op] ?? op,
            category: 'operator' as SuggestionCategory
          })
        )
      : ctx.partial === ''
        ? [{ value: '', label: `Type a value for ${name}, then press Enter`, category: 'hint' }]
        : []
  return hint === null ? rest : [hint, ...rest]
}
