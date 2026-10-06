import { sql } from 'kysely'
import { NUMERIC_COLUMN_FILTER_KEYS } from '../../../shared/filters/column-filter-validation'
import type { Variant, VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import { SORTABLE_COLUMNS } from './sortable-columns'

type ColumnFilterDef = NonNullable<VariantFilter['column_filters']>[string]
type ComparableValue = string | number
type RangeOperator = '<' | '>' | '<=' | '>='

function isComparable(value: unknown): value is ComparableValue {
  return typeof value === 'string' || typeof value === 'number'
}

/**
 * Bind a comparison value in the storage class of its column: numbers for
 * numeric columns, text for everything else.
 *
 * The distinction matters because better-sqlite3 binds every JS number as a
 * REAL. Compared with a TEXT column SQLite renders it as text first, so
 * `chr = 7` becomes `chr = '7.0'` and can never match the stored `'7'`.
 */
function coerceComparisonValue(value: ComparableValue, numericColumn: boolean): ComparableValue {
  if (!numericColumn) return String(value)
  const num = Number(value)
  return typeof value === 'number' ? value : Number.isFinite(num) ? num : value
}

/** Parameterized IN clause using sql.join; an empty list is skipped. */
function whereIn(
  query: VariantQueryBuilder,
  sqlColumn: string,
  value: readonly unknown[]
): VariantQueryBuilder {
  if (value.length === 0) return query
  const params = sql.join(value.map((v) => sql`${String(v)}`))
  return query.where(sql<boolean>`${sql.ref(sqlColumn)} IN (${params})`)
}

/** Case-insensitive substring match. Blank input is skipped — LIKE '%%' excludes NULLs. */
function whereLike(
  query: VariantQueryBuilder,
  sqlColumn: string,
  value: string
): VariantQueryBuilder {
  if (value.trim() === '') return query
  return query.where(sql`${sql.ref(sqlColumn)} COLLATE NOCASE`, 'like', `%${value}%`)
}

/** Range comparison — includeEmpty defaults to true (don't lose unannotated variants). */
function whereRange(
  query: VariantQueryBuilder,
  sqlColumn: string,
  operator: RangeOperator,
  compValue: ComparableValue,
  includeEmpty: boolean | undefined
): VariantQueryBuilder {
  const col = sqlColumn as keyof Variant
  if (includeEmpty !== false) {
    return query.where(({ or, eb }) => or([eb(col, 'is', null), eb(col, operator, compValue)]))
  }
  return query.where(col, operator, compValue)
}

/** Translate one bare-key column filter; unsupported operator/value shapes are ignored. */
function applyColumnFilter(
  query: VariantQueryBuilder,
  sqlColumn: string,
  filterDef: ColumnFilterDef,
  numericColumn: boolean
): VariantQueryBuilder {
  const { operator, value } = filterDef
  if (operator === 'in' && Array.isArray(value)) return whereIn(query, sqlColumn, value)
  if (operator === 'like' && typeof value === 'string') return whereLike(query, sqlColumn, value)
  if ((operator === '=' || operator === '!=') && isComparable(value)) {
    // Exact match — NULLs excluded (user is looking for specific values)
    const compValue = coerceComparisonValue(value, numericColumn)
    return query.where(sqlColumn as keyof Variant, operator, compValue)
  }
  if (
    (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
    isComparable(value)
  ) {
    const compValue = coerceComparisonValue(value, numericColumn)
    return whereRange(query, sqlColumn, operator, compValue, filterDef.includeEmpty)
  }
  return query
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
    const baseColumn = SORTABLE_COLUMNS[column]
    if (baseColumn === undefined) continue
    // Always table-qualified: the `variant_frequency` join in the base query
    // also exposes `chr` / `pos`, so a bare reference is ambiguous in SQLite.
    filtered = applyColumnFilter(
      filtered,
      `variants.${baseColumn}`,
      filterDef,
      NUMERIC_COLUMN_FILTER_KEYS.has(column)
    )
  }
  return filtered
}
