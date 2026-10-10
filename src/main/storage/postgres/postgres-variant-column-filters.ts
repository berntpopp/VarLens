/**
 * Per-column filters (`column_filters`) of the PostgreSQL case variant list.
 * Extracted from PostgresVariantReadRepository; the SQLite twin is
 * src/main/database/variant-filter/column-filters.ts. Also holds the HGVS
 * search predicate the case and the cohort summary builders share.
 */
import { escapeLikePattern } from '../../database/search/search-clause-emitter'
import { isSeverityKey } from '../../../shared/config/severity.config'
import { buildNullCheckSql, isNullCheckOperator } from '../../../shared/filters/column-null-check'
import { severityFilterOperands, severityFilterSql } from '../../../shared/filters/severity-filter'
import type { CarrierRanks } from '../../../shared/sql/cohort-representative'
import type { VariantFilter } from '../../../shared/types/database'
import { POSTGRES_VARIANT_COLUMN_DEFINITIONS } from './postgres-variant-columns'

/** `c.`/`p.` tokens are HGVS: matched by ILIKE on cdna / aa_change, like SQLite. */
export const HGVS_TOKEN = /^[cp]\./

/** Shared by the case search (`v`) and the cohort summary search (`cvs`). */
export function hgvsSearchSql(
  alias: string,
  token: string,
  addParam: (value: unknown) => string
): string {
  const pattern = addParam(`%${escapeLikePattern(token)}%`)
  return `(${alias}.cdna ILIKE ${pattern} ESCAPE '\\' OR ${alias}.aa_change ILIKE ${pattern} ESCAPE '\\')`
}

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
      addWhere(`${textColumn} ILIKE ${addParam(`%${escapeLikePattern(value)}%`)} ESCAPE '\\'`)
    } else if (
      (operator === '=' || operator === '!=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      addWhere(
        `${sqlColumn} ${operator} ${addParam(normalizePostgresColumnFilterValue(value, definition.kind === 'numeric'))}`
      )
    } else if (
      (operator === '<' || operator === '>' || operator === '<=' || operator === '>=') &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      const comparison = `${sqlColumn} ${operator} ${addParam(normalizePostgresColumnFilterValue(value, definition.kind === 'numeric'))}`
      const includeEmpty = filterDef.includeEmpty ?? !column.includes('.')
      addWhere(includeEmpty ? `(${sqlColumn} IS NULL OR ${comparison})` : comparison)
    }
  }
}

export function hasPostgresColumnFilterPrefix(filter: VariantFilter, prefix: string): boolean {
  return Object.keys(filter.column_filters ?? {}).some((column) => column.startsWith(prefix))
}

/** Only numeric columns coerce: on a text column "007" must stay "007" (#510). */
export function normalizePostgresColumnFilterValue(
  value: string | number,
  isNumeric: boolean
): string | number {
  if (!isNumeric || typeof value === 'number') return value
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : value
}
