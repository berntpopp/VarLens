import { sql } from 'kysely'
import type { Variant, VariantFilter } from '../types'
import type { VariantQueryBuilder } from './query-types'
import { SORTABLE_COLUMNS } from './sortable-columns'

type ColumnFilterDef = NonNullable<VariantFilter['column_filters']>[string]
type ComparableValue = string | number
type RangeOperator = '<' | '>' | '<=' | '>='

function isComparable(value: unknown): value is ComparableValue {
  return typeof value === 'string' || typeof value === 'number'
}

/** Numeric strings compare as numbers; everything else compares as given. */
function coerceComparisonValue(value: ComparableValue): ComparableValue {
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
  value: ComparableValue,
  includeEmpty: boolean | undefined
): VariantQueryBuilder {
  const compValue = coerceComparisonValue(value)
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
  filterDef: ColumnFilterDef
): VariantQueryBuilder {
  const { operator, value } = filterDef
  if (operator === 'in' && Array.isArray(value)) return whereIn(query, sqlColumn, value)
  if (operator === 'like' && typeof value === 'string') return whereLike(query, sqlColumn, value)
  if ((operator === '=' || operator === '!=') && isComparable(value)) {
    // Exact match — NULLs excluded (user is looking for specific values)
    return query.where(sqlColumn as keyof Variant, operator, coerceComparisonValue(value))
  }
  if (
    (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
    isComparable(value)
  ) {
    return whereRange(query, sqlColumn, operator, value, filterDef.includeEmpty)
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
    const sqlColumn = SORTABLE_COLUMNS[column]
    if (sqlColumn === undefined) continue
    filtered = applyColumnFilter(filtered, sqlColumn, filterDef)
  }
  return filtered
}
