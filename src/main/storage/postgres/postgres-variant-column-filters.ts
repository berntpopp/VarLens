/**
 * Per-column filters (`column_filters`) of the PostgreSQL case variant list.
 * Extracted from PostgresVariantReadRepository; the SQLite twin is
 * src/main/database/variant-filter/column-filters.ts.
 */
import { isSeverityKey } from '../../../shared/config/severity.config'
import { buildNullCheckSql, isNullCheckOperator } from '../../../shared/filters/column-null-check'
import { severityFilterOperands, severityFilterSql } from '../../../shared/filters/severity-filter'
import type { CarrierRanks } from '../../../shared/sql/cohort-representative'
import type { VariantFilter } from '../../../shared/types/database'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from './postgres-variant-columns'

export function addPostgresColumnFilters(
  filter: VariantFilter,
  addParam: (value: unknown) => string,
  addWhere: (sql: string) => void,
  ranks: CarrierRanks
): void {
  if (filter.column_filters === undefined) return

  const unsupportedColumns = Object.keys(filter.column_filters).filter(
    (column) => POSTGRES_VARIANT_COLUMN_DEFINITIONS[column] === undefined
  )
  if (unsupportedColumns.length > 0) {
    throw new Error(`Unsupported PostgreSQL column filter(s): ${unsupportedColumns.join(', ')}`)
  }

  for (const [column, filterDef] of Object.entries(filter.column_filters)) {
    const definition = POSTGRES_VARIANT_COLUMN_DEFINITIONS[column]
    const sqlColumn = definition.sql
    const { operator, value } = filterDef

    const severity = isSeverityKey(column) ? severityFilterOperands(operator, value) : null
    if (isNullCheckOperator(operator)) {
      const numeric = definition.kind === 'numeric'
      addWhere(buildNullCheckSql(sqlColumn, operator, numeric, 'postgres'))
    } else if (isSeverityKey(column) && severity !== null) {
      const clause = severityFilterSql(
        column,
        severity.values,
        {
          column: sqlColumn,
          rank: column === 'clinvar' ? ranks.clinvar : ranks.impact,
          bind: (item) => addParam(item)
        },
        severity.negate
      )
      if (clause !== null) addWhere(clause)
    } else if (operator === 'in' && Array.isArray(value)) {
      if (value.length === 0) continue
      addWhere(`${sqlColumn} IN (${value.map((item) => addParam(String(item))).join(', ')})`)
    } else if (operator === 'like' && typeof value === 'string') {
      if (value.trim() === '') continue
      // Numeric columns need the cast: `double precision ILIKE text` does not exist.
      const textColumn = definition.kind === 'numeric' ? `${sqlColumn}::text` : sqlColumn
      addWhere(`${textColumn} ILIKE ${addParam(`%${value}%`)}`)
    } else if (
      (operator === '=' || operator === '!=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      addWhere(`${sqlColumn} ${operator} ${addParam(normalizePostgresColumnFilterValue(value))}`)
    } else if (
      (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      const comparison = `${sqlColumn} ${operator} ${addParam(normalizePostgresColumnFilterValue(value))}`
      const includeEmpty = filterDef.includeEmpty ?? !column.includes('.')
      addWhere(includeEmpty ? `(${sqlColumn} IS NULL OR ${comparison})` : comparison)
    }
  }
}

export function hasPostgresColumnFilterPrefix(filter: VariantFilter, prefix: string): boolean {
  return Object.keys(filter.column_filters ?? {}).some((column) => column.startsWith(prefix))
}

function normalizePostgresColumnFilterValue(value: string | number): string | number {
  if (typeof value === 'number') return value
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : value
}
