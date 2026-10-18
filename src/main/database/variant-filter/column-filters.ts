import { isSeverityKey } from '../../../shared/config/severity.config'
import { severityFilterOperands } from '../../../shared/filters/severity-filter'
import { boundPredicate, PLACEHOLDER, whereSeverity } from './severity-filter'
import { infoFieldFilterSql, infoFieldKey } from '../../../shared/filters/info-field-filter'
import { sql } from 'kysely'
import { escapeLikePattern } from '../search/search-clause-emitter'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../../shared/filters/column-filter-validation'
import { buildNullCheckSql, isNullCheckOperator } from '../../../shared/filters/column-null-check'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import { SORTABLE_COLUMNS } from './sortable-columns'
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

/**
 * Shared dialect-aware bare column filter translator across SQL variant query paths (Path 2 and 3).
 * Translates null checks, IN, LIKE/ILIKE, equality, and range comparisons.
 */
export function translateBareColumnFilter(
  sqlColumn: string,
  filterDef: { operator: string; value: unknown; includeEmpty?: boolean },
  options: ColumnFilterTranslationOptions
): string | null {
  const { operator, value } = filterDef
  if (isNullCheckOperator(operator)) {
    return buildNullCheckSql(sqlColumn, operator, options.numericColumn, options.dialect)
  }
  if (operator === 'in' && Array.isArray(value)) {
    if (value.length === 0) return null
    const placeholders = value
      .map((item) =>
        options.bind(
          options.numericColumn && (typeof item === 'string' || typeof item === 'number')
            ? coerceColumnFilterComparisonValue(item, true)
            : String(item)
        )
      )
      .join(', ')
    return `${sqlColumn} IN (${placeholders})`
  }
  if (operator === 'like' && typeof value === 'string') {
    if (value.trim() === '') return null
    const pattern = `%${escapeLikePattern(value)}%`
    const placeholder = options.bind(pattern)
    if (options.dialect === 'postgres') {
      const textColumn = options.numericColumn ? `${sqlColumn}::text` : sqlColumn
      return `${textColumn} ILIKE ${placeholder} ESCAPE '\\'`
    }
    return `${sqlColumn} LIKE ${placeholder} ESCAPE '\\' COLLATE NOCASE`
  }
  if (
    (operator === '=' || operator === '!=') &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    const compValue = coerceColumnFilterComparisonValue(value, options.numericColumn)
    return `${sqlColumn} ${operator} ${options.bind(compValue)}`
  }
  if (
    (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
    (typeof value === 'string' || typeof value === 'number')
  ) {
    const compValue = coerceColumnFilterComparisonValue(value, options.numericColumn)
    const comparison = `${sqlColumn} ${operator} ${options.bind(compValue)}`
    const includeEmpty = filterDef.includeEmpty ?? options.includeEmptyDefault ?? true
    return includeEmpty ? `(${sqlColumn} IS NULL OR ${comparison})` : comparison
  }
  return null
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
  value: readonly unknown[]
): VariantQueryBuilder {
  if (value.length === 0) return query
  const params = sql.join(value.map((v) => sql`${String(v)}`))
  return query.where(sql<boolean>`${target(sqlColumn)} IN (${params})`)
}

/** Case-insensitive substring match. Blank input is skipped — LIKE '%%' excludes NULLs. */
function whereLike(
  query: VariantQueryBuilder,
  sqlColumn: string,
  value: string
): VariantQueryBuilder {
  if (value.trim() === '') return query
  const pattern = `%${escapeLikePattern(value)}%`
  return query.where(sql<boolean>`${target(sqlColumn)} COLLATE NOCASE LIKE ${pattern} ESCAPE '\\'`)
}

/** Range comparison — includeEmpty defaults to true (don't lose unannotated variants). */
function whereRange(
  query: VariantQueryBuilder,
  sqlColumn: string,
  operator: RangeOperator,
  compValue: ComparableValue,
  includeEmpty: boolean | undefined
): VariantQueryBuilder {
  const col = target(sqlColumn)
  if (includeEmpty !== false) {
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
  const { operator, value } = filterDef
  if (isNullCheckOperator(operator)) {
    // `sqlColumn` comes from SORTABLE_COLUMNS (internal), so sql.raw is safe.
    return query.where(
      sql.raw<boolean>(buildNullCheckSql(sqlColumn, operator, numericColumn, 'sqlite'))
    )
  }
  if (operator === 'in' && Array.isArray(value)) return whereIn(query, sqlColumn, value)
  if (operator === 'like' && typeof value === 'string') return whereLike(query, sqlColumn, value)
  if ((operator === '=' || operator === '!=') && isComparable(value)) {
    // Exact match — NULLs excluded (user is looking for specific values)
    const compValue = coerceColumnFilterComparisonValue(value, numericColumn)
    return query.where(target(sqlColumn), operator, compValue)
  }
  if (
    (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
    isComparable(value)
  ) {
    const compValue = coerceColumnFilterComparisonValue(value, numericColumn)
    return whereRange(query, sqlColumn, operator, compValue, filterDef.includeEmpty)
  }
  return query
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
    const baseColumn = SORTABLE_COLUMNS[column]
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
