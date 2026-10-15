/**
 * Correlated carrier `EXISTS` clauses for `info.<KEY>` filters on the cohort
 * summary (`cohort_variant_summary`, #639), shared by SQLite and PostgreSQL.
 *
 * A summary row matches an `info.<KEY>` predicate when at least one ready
 * carrier row of the same coordinate, variant type and genome build satisfies
 * {@link infoFieldFilterSql} on `variants.info_json`.
 */
import { infoFieldFilterSql, infoFieldKey } from '../filters/info-field-filter'
import type { ColumnFiltersParam } from '../types/column-filters'
import type { SqlDialect } from './chromosome-order'
import { carrierRowSql } from './genotype-dosage'

export function cohortInfoExistsClauses(
  columnFilters: ColumnFiltersParam | undefined,
  cvsAlias: string,
  dialect: SqlDialect,
  bind: (value: string | number) => string,
  schemaPrefix = ''
): string[] {
  if (columnFilters === undefined) return []
  const readyClause = dialect === 'sqlite' ? " AND vc.import_status = 'ready'" : ''
  const clauses: string[] = []
  for (const [col, filter] of Object.entries(columnFilters)) {
    const key = infoFieldKey(col)
    if (key === null || filter === undefined) continue
    const predicate = infoFieldFilterSql(key, filter, {
      dialect,
      infoJson: 'v.info_json',
      bind
    })
    if (predicate === null) continue
    const notNullGuard =
      filter.operator !== 'is_null' ? '\n          AND v.info_json IS NOT NULL' : ''
    clauses.push(
      `EXISTS (
        SELECT 1 FROM ${schemaPrefix}variants v
        JOIN ${schemaPrefix}cases vc ON vc.id = v.case_id${readyClause}
          AND vc.genome_build = ${cvsAlias}.genome_build
        WHERE v.chr = ${cvsAlias}.chr AND v.pos = ${cvsAlias}.pos
          AND v.ref = ${cvsAlias}.ref AND v.alt = ${cvsAlias}.alt
          AND v.variant_type = ${cvsAlias}.variant_type
          AND ${carrierRowSql('v')}${notNullGuard}
          AND ${predicate}
      )`
    )
  }
  return clauses
}
