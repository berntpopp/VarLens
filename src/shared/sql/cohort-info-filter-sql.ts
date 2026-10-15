/**
 * Correlated carrier `EXISTS` clauses for `info.<KEY>` filters on the cohort
 * summary (`cohort_variant_summary`, #639), shared by SQLite and PostgreSQL.
 *
 * A summary row matches an `info.<KEY>` predicate when at least one ready
 * carrier row of the same coordinate, variant type and genome build satisfies
 * {@link infoFieldFilterSql} on `variants.info_json`.
 */
import { CLINVAR_CATEGORIES, IMPACT_RANK_BY_LEVEL } from '../config/severity.config'
import { infoFieldFilterSql, infoFieldKey } from '../filters/info-field-filter'
import type { ColumnFiltersParam } from '../types/column-filters'
import type { SqlDialect } from './chromosome-order'
import { carrierRowSql } from './genotype-dosage'

const HOT_CLINVAR_RANKS = CLINVAR_CATEGORIES.filter(
  (c) =>
    c.id === 'pathogenic' || c.id === 'pathogenic_likely_pathogenic' || c.id === 'likely_pathogenic'
)
  .map((c) => c.rank)
  .join(', ')

export function cohortUnreviewedHotClause(
  cvsAlias: string,
  dialect: SqlDialect,
  schemaPrefix = ''
): string {
  const falseLit = dialect === 'sqlite' ? '0' : 'false'
  const readyClause =
    dialect === 'sqlite' ? " AND COALESCE(c.import_status, 'ready') = 'ready'" : ''
  return `((${cvsAlias}.impact_rank = ${IMPACT_RANK_BY_LEVEL.HIGH} OR ${cvsAlias}.consequence = 'HIGH' OR ${cvsAlias}.clinvar_rank IN (${HOT_CLINVAR_RANKS}) OR ${cvsAlias}.clinvar IN ('Pathogenic', 'Likely_pathogenic', 'Pathogenic/Likely_pathogenic')) AND ${cvsAlias}.acmg_best IS NULL AND COALESCE(${cvsAlias}.has_star, ${falseLit}) = ${falseLit} AND COALESCE(${cvsAlias}.has_comment, ${falseLit}) = ${falseLit} AND NOT EXISTS (SELECT 1 FROM ${schemaPrefix}variant_tags vt JOIN ${schemaPrefix}variants v ON v.id = vt.variant_id JOIN ${schemaPrefix}cases c ON c.id = vt.case_id WHERE v.chr = ${cvsAlias}.chr AND v.pos = ${cvsAlias}.pos AND v.ref = ${cvsAlias}.ref AND v.alt = ${cvsAlias}.alt AND COALESCE(v.variant_type, 'snv') = ${cvsAlias}.variant_type AND COALESCE(c.genome_build, 'GRCh38') = ${cvsAlias}.genome_build${readyClause}))`
}

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
