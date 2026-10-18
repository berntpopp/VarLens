import { isSeverityKey } from '../../../shared/config/severity.config'
import { severityFilterOperands } from '../../../shared/filters/severity-filter'
import { boundPredicate, PLACEHOLDER, whereSeverity } from './severity-filter'
import { infoFieldFilterSql, infoFieldKey } from '../../../shared/filters/info-field-filter'
import { escapeLikePattern } from '../search/search-clause-emitter'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../../shared/filters/column-filter-validation'
import { buildNullCheckSql, isNullCheckOperator } from '../../../shared/filters/column-null-check'
import type { VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import { SORTABLE_COLUMNS } from './sortable-columns'
import { comparedColumnSql } from '../../../shared/sql/unsigned-columns'
import { casePhenotypeScoreSql, PHENOTYPE_SCORE_KEY } from '../../../shared/sql/phenotype-score-sql'

type ColumnFilterDef = NonNullable<VariantFilter['column_filters']>[string]

export interface ColumnFilterTranslationOptions {
  dialect: 'sqlite' | 'postgres'
  numericColumn: boolean
  bind: (value: unknown) => string
  includeEmptyDefault?: boolean
}

/**
 * Bind/normalize a comparison value in the storage class of its column: numbers for
 * numeric columns, text for everything else.
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
 * Shared dialect-aware bare column filter translator across all variant query paths.
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
          typeof item === 'string' || typeof item === 'number'
            ? coerceColumnFilterComparisonValue(item, options.numericColumn)
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

/** Translate one bare-key column filter using the shared dialect-aware translator. */
function applyColumnFilter(
  query: VariantQueryBuilder,
  sqlColumn: string,
  filterDef: ColumnFilterDef,
  numericColumn: boolean
): VariantQueryBuilder {
  const bound: unknown[] = []
  const clause = translateBareColumnFilter(sqlColumn, filterDef, {
    dialect: 'sqlite',
    numericColumn,
    bind: (v) => {
      bound.push(v)
      return PLACEHOLDER
    }
  })
  return clause === null ? query : query.where(boundPredicate(clause, bound))
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
 * Column filters on bare `variants` keys (dynamic, type-aware). Dotted
 * extension keys are handled by the extension join step; unknown keys are
 * ignored.
 *
 * TODO: fold this bare-key translator into `variant-where-builder.ts` so
 * there's a single source of truth for column_filter semantics across
 * all three query paths. The logic here has converged with
 * `translateColumnFilter` used by Path 2/3, but the duplication is
 * currently preserved because Path 1 uses Kysely chain builders while
 * Path 2/3 use raw SQL + parameter interpolation. Unifying would require
 * a Kysely-aware emitter in `variant-where-builder` or a shared AST.
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
