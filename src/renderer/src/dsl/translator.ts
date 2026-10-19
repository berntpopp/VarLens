/**
 * Translates a parsed DSL AST into backend-compatible filter structures.
 *
 * Maps DSL operators to the ColumnFilter operators that the backend
 * already supports (from Phase 2). Also collects @preset references.
 */

import type { DslNode, DslFilterRule, DslGroup, DslOperator } from './types'
import type { ColumnFilter } from '../../../shared/types/column-filters'
import { findColumn } from './column-registry'
import { contigQueryNames } from '../../../shared/utils/contig'
export { normalizeClinicalPaste } from './clinical-paste'

export type ExtendedColumnFilter =
  | (ColumnFilter & { includeEmpty?: boolean })
  | { operator: 'between'; value: [number, number]; includeEmpty?: boolean }

/** Result of translating a DSL AST */
export interface TranslationResult {
  /** Column filters to merge into the query (key = column name) */
  columnFilters: Record<string, ExtendedColumnFilter>
  /** Names of @preset references found in the expression */
  presetNames: string[]
  /**
   * Expressions a flat column-filter map cannot represent faithfully. When
   * non-empty the whole expression must be rejected — never partially applied.
   */
  errors: string[]
}

/** DSL → backend operator; `!~`, `^`, `$` are rejected by the parser. */
const BACKEND_OPERATORS: Partial<Record<DslOperator, ColumnFilter['operator']>> = {
  '=': '=',
  '!=': '!=',
  '<': '<',
  '>': '>',
  '<=': '<=',
  '>=': '>=',
  '~': 'like',
  'is:null': 'is_null',
  'is:notnull': 'not_null'
}

/** A rule as the user would type it, for error messages. */
export function formatRule(rule: DslFilterRule): string {
  return rule.value === null
    ? `${rule.column}:${rule.operator}`
    : `${rule.column}:${rule.operator}:${rule.value}`
}

function describe(node: DslNode): string {
  if (node.type === 'rule') return formatRule(node)
  if (node.type === 'preset') return `@${node.name}`
  return `(${node.children.map(describe).join(` ${node.combinator} `)})`
}

function setFilter(
  result: TranslationResult,
  column: string,
  filter: ColumnFilter,
  source: string
): void {
  const existing = result.columnFilters[column]
  if (existing !== undefined) {
    if (column === 'pos') {
      const isExistingLower = existing.operator === '>=' || existing.operator === '>'
      const isExistingUpper = existing.operator === '<=' || existing.operator === '<'
      const isNewLower = filter.operator === '>=' || filter.operator === '>'
      const isNewUpper = filter.operator === '<=' || filter.operator === '<'

      if ((isExistingLower && isNewUpper) || (isExistingUpper && isNewLower)) {
        const v1 = Number(existing.value)
        const v2 = Number(filter.value)
        if (Number.isFinite(v1) && Number.isFinite(v2)) {
          const min = Math.min(v1, v2)
          const max = Math.max(v1, v2)
          result.columnFilters[column] = {
            operator: 'between',
            value: [min, max]
          }
          return
        }
      }
    }

    // A flat map holds one condition per field: overwriting would drop a bound
    result.errors.push(
      `${source}: only one condition per field is supported ('${column}' is used twice)`
    )
    return
  }
  result.columnFilters[column] = filter
}

const isChromosome = (column: string): boolean => findColumn(column)?.key === 'chr'

function translateRule(rule: DslFilterRule, result: TranslationResult): void {
  const { column, operator, value } = rule
  const backendOp = BACKEND_OPERATORS[operator]
  if (backendOp === undefined) {
    result.errors.push(`${formatRule(rule)}: operator '${operator}' is not supported`)
    return
  }
  // Null checks carry no value (`= ''` would be coerced to `= 0` on numeric columns)
  const filter: ColumnFilter =
    backendOp === 'is_null' || backendOp === 'not_null'
      ? { operator: backendOp, value: '' }
      : { operator: backendOp, value: value ?? '' }
  const def = findColumn(column)
  if (def?.type === 'numeric' && ['<', '>', '<=', '>='].includes(operator)) {
    filter.includeEmpty = def.rangeExcludesEmpty !== true
  }
  // Each build stores its own contig spelling: `chr:1` means chr1 or 1.
  // ponytail: `chr != 1` stays a single-spelling comparison (no NOT IN operator).
  if (isChromosome(column) && backendOp === '=') {
    setFilter(
      result,
      column,
      { operator: 'in', value: contigQueryNames(String(value)) },
      formatRule(rule)
    )
    return
  }
  setFilter(result, column, filter, formatRule(rule))
}

/** Only equality alternatives on one field have a faithful flat form: IN. */
function translateOr(node: DslGroup, result: TranslationResult): void {
  const rules = node.children.filter((c): c is DslFilterRule => c.type === 'rule')
  const column = rules[0]?.column
  const faithful =
    rules.length === node.children.length &&
    rules.every((r) => r.column === column && r.operator === '=')
  if (!faithful || column === undefined) {
    result.errors.push(
      `${describe(node)}: OR is only supported between '=' conditions on the same field`
    )
    return
  }
  const values = [
    ...new Set(
      rules.flatMap((r) =>
        isChromosome(column) ? contigQueryNames(String(r.value)) : [String(r.value)]
      )
    )
  ]
  setFilter(result, column, { operator: 'in', value: values }, describe(node))
}

function translateNode(node: DslNode, result: TranslationResult): void {
  switch (node.type) {
    case 'rule':
      translateRule(node, result)
      break
    case 'preset':
      result.presetNames.push(node.name)
      break
    case 'group':
      if (node.combinator === 'OR') translateOr(node, result)
      else for (const child of node.children) translateNode(child, result)
      break
  }
}

/**
 * Translate a parsed DSL AST into backend filter structures.
 *
 * AND groups merge into one column-filter map (one condition per field).
 * OR is only representable as `in` over equality alternatives on one field.
 * Everything else — repeated fields, cross-field or non-equality OR, several
 * @presets (preset merging is overwrite/union, not AND) — is reported in
 * `errors` so the caller rejects the expression atomically.
 */
export function translateAst(ast: DslNode): TranslationResult {
  const result: TranslationResult = { columnFilters: {}, presetNames: [], errors: [] }
  translateNode(ast, result)
  if (result.presetNames.length > 1) {
    result.errors.push(
      `${result.presetNames.map((n) => `@${n}`).join(', ')}: only one @preset per expression is supported`
    )
  }
  return result
}

const DSL_OPERATORS: Record<ColumnFilter['operator'], string> = {
  '=': '=',
  '!=': '!=',
  '<': '<',
  '>': '>',
  '<=': '<=',
  '>=': '>=',
  like: '~',
  in: '=',
  is_null: 'is:null',
  not_null: 'is:notnull'
}

function quoteValue(value: string | number): string {
  const text = String(value)
  if (/^[^\s:()'"=<>!~^$@\\]+$/.test(text) && !/^(and|or)$/i.test(text)) return text
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`
}

/**
 * The DSL text for a translated column-filter map — the inverse of
 * {@link translateAst} for everything it produces. Used to keep the committed
 * search text (and so `?q=`) in step when one applied condition is removed.
 */
export function serializeColumnFilters(
  columnFilters: Record<string, ColumnFilter | ExtendedColumnFilter>
): string {
  return Object.entries(columnFilters)
    .map(([column, { operator, value }]) => {
      if ((operator as string) === 'between' && Array.isArray(value)) {
        return `${column}:>=:${value[0]} AND ${column}:<=:${value[1]}`
      }
      const op = DSL_OPERATORS[operator]
      if (operator === 'is_null' || operator === 'not_null') return `${column}:${op}`
      if (Array.isArray(value)) {
        const alternatives = value.map((v) => `${column}:=:${quoteValue(v)}`).join(' OR ')
        return value.length > 1 ? `(${alternatives})` : alternatives
      }
      return `${column}:${op}:${quoteValue(value)}`
    })
    .join(' AND ')
}
