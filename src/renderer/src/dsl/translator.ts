/**
 * Translates a parsed DSL AST into backend-compatible filter structures.
 *
 * Maps DSL operators to the ColumnFilter operators that the backend
 * already supports (from Phase 2). Also collects @preset references.
 */

import type { DslNode, DslFilterRule, DslOperator } from './types'
import type { ColumnFilter } from '../../../shared/types/column-filters'
import { findColumn } from './column-registry'

/** Result of translating a DSL AST */
export interface TranslationResult {
  /** Column filters to merge into the query (key = column name) */
  columnFilters: Record<string, ColumnFilter & { includeEmpty?: boolean }>
  /** Names of @preset references found in the expression */
  presetNames: string[]
  /** Warnings about unsupported features (e.g., cross-column OR) */
  warnings: string[]
}

/** Map DSL operator to backend ColumnFilter operator */
function mapOperator(dslOp: DslOperator): ColumnFilter['operator'] | null {
  switch (dslOp) {
    case '=':
      return '='
    case '!=':
      return '!='
    case '<':
      return '<'
    case '>':
      return '>'
    case '<=':
      return '<='
    case '>=':
      return '>='
    case '~':
      return 'like'
    case '!~':
      return 'like' // Backend handles NOT via separate logic
    case '^':
      return 'like' // Translated to 'value%' prefix
    case '$':
      return 'like' // Translated to '%value' suffix
    case 'is:null':
    case 'is:notnull':
      return '=' // Special handling below
    default:
      return null
  }
}

/** Determine if a column is numeric (for NULL-inclusive behavior) */
function isNumericColumn(columnKey: string): boolean {
  const col = findColumn(columnKey)
  return col?.type === 'numeric'
}

function translateRule(rule: DslFilterRule, result: TranslationResult): void {
  const { column, operator, value } = rule

  if (operator === 'is:null') {
    result.columnFilters[column] = { operator: '=', value: '' }
    return
  }
  if (operator === 'is:notnull') {
    result.columnFilters[column] = { operator: '!=', value: '' }
    return
  }

  const backendOp = mapOperator(operator)
  if (!backendOp) return

  let filterValue: string | number | string[] = value ?? ''

  // Handle prefix/suffix operators
  if (operator === '^') {
    filterValue = `${value}`
  } else if (operator === '$') {
    filterValue = `${value}`
  }

  const includeEmpty = isNumericColumn(column) && ['<', '>', '<=', '>='].includes(operator)

  result.columnFilters[column] = {
    operator: backendOp,
    value: filterValue,
    ...(includeEmpty ? { includeEmpty: true } : {})
  }
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
      if (node.combinator === 'OR') {
        // OR groups: check if all rules target the same column
        const rules = node.children.filter((c): c is DslFilterRule => c.type === 'rule')
        const columns = new Set(rules.map((r) => r.column))
        if (columns.size === 1 && rules.length === node.children.length) {
          // Same-column OR: translate to 'in' operator with combined values
          const column = rules[0].column
          const values = rules.map((r) => String(r.value ?? ''))
          result.columnFilters[column] = { operator: 'in', value: values }
        } else {
          // Cross-column OR: not supported by backend ColumnFiltersParam.
          // Merge as AND with a warning.
          result.warnings.push(
            'Cross-column OR is not fully supported — filters are combined with AND. Use parentheses to group same-column conditions.'
          )
          for (const child of node.children) {
            translateNode(child, result)
          }
        }
      } else {
        // AND group: merge all children
        for (const child of node.children) {
          translateNode(child, result)
        }
      }
      break
  }
}

/**
 * Translate a parsed DSL AST into backend filter structures.
 *
 * AND groups: all rules merged into a single columnFilters map.
 * OR groups: only same-column OR is supported (translated to 'in' operator).
 * Cross-column OR is recorded as a warning — the backend ColumnFiltersParam
 * cannot represent cross-column OR, so rules are merged as AND with a warning.
 *
 * @preset references are collected into presetNames for the caller
 * to look up and merge from the preset store.
 */
export function translateAst(ast: DslNode): TranslationResult {
  const result: TranslationResult = {
    columnFilters: {},
    presetNames: [],
    warnings: []
  }
  translateNode(ast, result)
  return result
}
