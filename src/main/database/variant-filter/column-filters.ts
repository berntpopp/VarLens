import { isSeverityKey } from '../../../shared/config/severity.config'
import { severityFilterOperands } from '../../../shared/filters/severity-filter'
import { boundPredicate, PLACEHOLDER, whereSeverity } from './severity-filter'
import { infoFieldFilterSql, infoFieldKey } from '../../../shared/filters/info-field-filter'
import { sql } from 'kysely'
import { escapeLikePattern } from '../search/search-clause-emitter'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../../shared/filters/column-filter-validation'
import {
  buildNullCheckSql,
  isNullCheckOperator,
  type NullCheckOperator
} from '../../../shared/filters/column-null-check'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import { BASE_FILTERABLE_COLUMNS } from './sortable-columns'
import { comparedColumnSql } from '../../../shared/sql/unsigned-columns'
import { casePhenotypeScoreSql, PHENOTYPE_SCORE_KEY } from '../../../shared/sql/phenotype-score-sql'

type ColumnFilterDef = NonNullable<VariantFilter['column_filters']>[string]
type ComparableValue = string | number
type RangeOperator = '<' | '>' | '<=' | '>='

function isComparable(value: unknown): value is ComparableValue {
  return typeof value === 'string' || typeof value === 'number'
}

export interface ColumnFilterTranslationOptions {
  dialect: 'sqlite' | 'postgres'
  numericColumn: boolean
  bind: (value: unknown) => string
  includeEmptyDefault?: boolean
}

/**
 * Bind/normalize a comparison value in the storage class of its column: numbers for
 * numeric columns, text for everything else.
 *
 * The distinction matters because better-sqlite3 binds every JS number as a
 * REAL. Compared with a TEXT column SQLite renders it as text first, so
 * `chr = 7` becomes `chr = '7.0'` and can never match the stored `'7'`.
 */
export function coerceColumnFilterComparisonValue(
  value: string | number,
  numericColumn: boolean
): string | number {
  if (!numericColumn) return String(value)
  const num = Number(value)
  return typeof value === 'number' ? value : Number.isFinite(num) ? num : value
}

type ParsedBareColumnFilter =
  | { kind: 'null'; operator: NullCheckOperator; numericColumn: boolean }
  | { kind: 'in'; values: Array<string | number> }
  | { kind: 'like'; pattern: string; numericColumn: boolean }
  | { kind: 'compare'; operator: '=' | '!='; value: string | number }
  | {
      kind: 'range'
      operator: RangeOperator
      value: string | number
      includeEmpty: boolean
    }
  | {
      kind: 'between'
      min: string | number
      max: string | number
      includeEmpty: boolean
    }

/**
 * Shared bare column filter parser. Normalizes operator and value shapes across
 * Kysely (Path 1), SQLite (Path 2), and PostgreSQL (Path 3).
 */
function parseBareColumnFilter(
  filterDef: { operator: string; value: unknown; includeEmpty?: boolean },
  numericColumn: boolean,
  includeEmptyDefault = true
): ParsedBareColumnFilter | null {
  const { operator, value } = filterDef
  if (isNullCheckOperator(operator)) {
    return { kind: 'null', operator, numericColumn }
  }
  if (operator === 'in' && Array.isArray(value)) {
    if (value.length === 0) return null
    return {
      kind: 'in',
      values: value.map((item) =>
        isComparable(item) ? coerceColumnFilterComparisonValue(item, numericColumn) : String(item)
      )
    }
  }
  if (operator === 'like' && typeof value === 'string') {
    if (value.trim() === '') return null
    return { kind: 'like', pattern: `%${escapeLikePattern(value)}%`, numericColumn }
  }
  if ((operator === '=' || operator === '!=') && isComparable(value)) {
    return {
      kind: 'compare',
      operator,
      value: coerceColumnFilterComparisonValue(value, numericColumn)
    }
  }
  if (
    (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
    isComparable(value)
  ) {
    return {
      kind: 'range',
      operator,
      value: coerceColumnFilterComparisonValue(value, numericColumn),
      includeEmpty: filterDef.includeEmpty ?? includeEmptyDefault
    }
  }
  if (
    operator === 'between' &&
    Array.isArray(value) &&
    value.length === 2 &&
    isComparable(value[0]) &&
    isComparable(value[1])
  ) {
    return {
      kind: 'between',
      min: coerceColumnFilterComparisonValue(value[0], numericColumn),
      max: coerceColumnFilterComparisonValue(value[1], numericColumn),
      includeEmpty: filterDef.includeEmpty ?? includeEmptyDefault
    }
  }
  return null
}

/**
 * Shared dialect-aware bare column filter translator across SQL variant query paths (Path 2 and 3).
 * Translates null checks, IN, LIKE/ILIKE, equality, and range comparisons.
 */
export function translateBareColumnFilter(
  sqlColumn: string,
  filterDef: { operator: string; value: unknown; includeEmpty?: boolean },
  options: ColumnFilterTranslationOptions
): string | null {
  const parsed = parseBareColumnFilter(
    filterDef,
    options.numericColumn,
    options.includeEmptyDefault ?? true
  )
  if (parsed === null) return null

  switch (parsed.kind) {
    case 'null':
      return buildNullCheckSql(sqlColumn, parsed.operator, parsed.numericColumn, options.dialect)
    case 'in': {
      const placeholders = parsed.values.map((v) => options.bind(v)).join(', ')
      return `${sqlColumn} IN (${placeholders})`
    }
    case 'like': {
      const placeholder = options.bind(parsed.pattern)
      if (options.dialect === 'postgres') {
        const textColumn = parsed.numericColumn ? `${sqlColumn}::text` : sqlColumn
        return `${textColumn} ILIKE ${placeholder} ESCAPE '\\'`
      }
      return `${sqlColumn} LIKE ${placeholder} ESCAPE '\\' COLLATE NOCASE`
    }
    case 'compare':
      return `${sqlColumn} ${parsed.operator} ${options.bind(parsed.value)}`
    case 'range': {
      const comparison = `${sqlColumn} ${parsed.operator} ${options.bind(parsed.value)}`
      return parsed.includeEmpty ? `(${sqlColumn} IS NULL OR ${comparison})` : comparison
    }
    case 'between': {
      const low = options.bind(parsed.min)
      const high = options.bind(parsed.max)
      const comparison = `(${sqlColumn} >= ${low} AND ${sqlColumn} <= ${high})`
      return parsed.includeEmpty ? `(${sqlColumn} IS NULL OR ${comparison})` : comparison
    }
  }
}

/**
 * `sqlColumn` below is internal SQL text, never user input: `variants.<column>`
 * from SORTABLE_COLUMNS (a quoted reference) or that column wrapped by
 * comparedColumnSql, e.g. `ABS(variants.sv_length)` (raw SQL).
 */
const target = (sqlColumn: string) =>
  sqlColumn.includes('(') ? sql.raw<unknown>(sqlColumn) : sql.ref<unknown>(sqlColumn)

/** Parameterized IN clause using sql.join; an empty list is skipped. */
function whereIn(
  query: VariantQueryBuilder,
  sqlColumn: string,
  values: readonly ComparableValue[]
): VariantQueryBuilder {
  if (values.length === 0) return query
  const params = sql.join(values.map((v) => sql`${v}`))
  return query.where(sql<boolean>`${target(sqlColumn)} IN (${params})`)
}

/** Range comparison — includeEmpty defaults to true (don't lose unannotated variants). */
function whereRange(
  query: VariantQueryBuilder,
  sqlColumn: string,
  operator: RangeOperator,
  compValue: ComparableValue,
  includeEmpty: boolean
): VariantQueryBuilder {
  const col = target(sqlColumn)
  if (includeEmpty) {
    return query.where(({ or, eb }) => or([eb(col, 'is', null), eb(col, operator, compValue)]))
  }
  return query.where(col, operator, compValue)
}

/** Translate one bare-key column filter for Kysely (Path 1); unsupported operator/value shapes are ignored. */
function applyColumnFilter(
  query: VariantQueryBuilder,
  sqlColumn: string,
  filterDef: ColumnFilterDef,
  numericColumn: boolean
): VariantQueryBuilder {
  const parsed = parseBareColumnFilter(filterDef, numericColumn, true)
  if (parsed === null) return query

  switch (parsed.kind) {
    case 'null':
      return query.where(
        sql.raw<boolean>(buildNullCheckSql(sqlColumn, parsed.operator, numericColumn, 'sqlite'))
      )
    case 'in':
      return whereIn(query, sqlColumn, parsed.values)
    case 'like':
      return query.where(
        sql<boolean>`${target(sqlColumn)} COLLATE NOCASE LIKE ${parsed.pattern} ESCAPE '\\'`
      )
    case 'compare':
      return query.where(target(sqlColumn), parsed.operator, parsed.value)
    case 'range':
      return whereRange(query, sqlColumn, parsed.operator, parsed.value, parsed.includeEmpty)
    case 'between': {
      const col = target(sqlColumn)
      if (parsed.includeEmpty) {
        return query.where(({ or, and, eb }) =>
          or([eb(col, 'is', null), and([eb(col, '>=', parsed.min), eb(col, '<=', parsed.max)])])
        )
      }
      return query.where(col, '>=', parsed.min).where(col, '<=', parsed.max)
    }
  }
}

/** `info.<KEY>` filter (#538); key and values were validated by assertValidColumnFilterValues. */
function whereInfoField(
  query: VariantQueryBuilder,
  key: string,
  filterDef: ColumnFilterDef
): VariantQueryBuilder {
  const bound: Array<string | number> = []
  const text = infoFieldFilterSql(key, filterDef, {
    dialect: 'sqlite',
    infoJson: 'variants.info_json',
    bind: (value) => {
      bound.push(value)
      return PLACEHOLDER
    }
  })
  return text === null ? query : query.where(boundPredicate(text, bound))
}

/**
 * Column filters on bare `variants` keys (dynamic, type-aware) for Path 1 Kysely query builder.
 * Dotted extension keys are handled by the extension join step; unknown keys are ignored.
 */
export function applyBareColumnFilters(
  query: VariantQueryBuilder,
  filter: VariantFilter
): VariantQueryBuilder {
  if (filter.column_filters === undefined) return query
  let filtered = query
  for (const [column, filterDef] of Object.entries(filter.column_filters)) {
    const infoKey = infoFieldKey(column)
    if (infoKey !== null) {
      filtered = whereInfoField(filtered, infoKey, filterDef)
      continue
    }
    if (column === PHENOTYPE_SCORE_KEY) {
      filtered = applyColumnFilter(filtered, casePhenotypeScoreSql('variants'), filterDef, true)
      continue
    }
    const baseColumn = BASE_FILTERABLE_COLUMNS[column]
    if (baseColumn === undefined) continue
    // Impact and ClinVar match by normalised category, like the cohort view.
    const severity = isSeverityKey(column)
      ? severityFilterOperands(filterDef.operator, filterDef.value)
      : null
    if (isSeverityKey(column) && severity !== null) {
      filtered = whereSeverity(filtered, column, severity.values, severity.negate)
      continue
    }
    // Always table-qualified, so no join of the base query can make a bare
    // column reference ambiguous in SQLite. Internal SQL text (SORTABLE_COLUMNS).
    filtered = applyColumnFilter(
      filtered,
      comparedColumnSql(column, `variants.${baseColumn}`),
      filterDef,
      NUMERIC_COLUMN_FILTER_KEYS.has(column)
    )
  }
  return filtered
}
