/**
 * The stored phenotype column (`case_phenotype_scores`, spec
 * .planning/specs/2026-10-15-phenotype-column.md) in table reads, one SQL text
 * for SQLite and PostgreSQL. Displayed values are looked up once per page
 * (never per row of the whole result, which a sort would otherwise evaluate);
 * the correlated expressions are for sorting and filtering only.
 */
import type { SqlDialect } from './chromosome-order'
import { carrierRowSql } from './genotype-dosage'
import type { CohortVariantIdentity } from '../types/cohort'

type Table = (name: string) => string
const plain: Table = (name) => name

/** Sort and column-filter key of the column, case and cohort view. */
export const PHENOTYPE_SCORE_KEY = 'phenotype_score'

/** The score of a case variant row (`alias` has case_id and gene_symbol); NULL without one. */
export function casePhenotypeScoreSql(alias: string, table: Table = plain): string {
  return `(SELECT ps.score FROM ${table('case_phenotype_scores')} ps
    WHERE ps.case_id = ${alias}.case_id AND ps.gene_symbol = ${alias}.gene_symbol)`
}

/** Carriers of a cohort row and their stored scores (same scope as cohortCarriersSql). */
function carrierScoresFrom(dialect: SqlDialect, table: Table): string {
  const ready = dialect === 'sqlite' ? " AND pc.import_status = 'ready'" : ''
  return `FROM ${table('variants')} pv
    JOIN ${table('cases')} pc ON pc.id = pv.case_id${ready}
    JOIN ${table('case_phenotype_scores')} ps
      ON ps.case_id = pv.case_id AND ps.gene_symbol = pv.gene_symbol`
}

/** Best stored score over the carriers of a cohort summary row `alias`. */
export function cohortPhenotypeScoreSql(
  alias: string,
  dialect: SqlDialect,
  table: Table = plain
): string {
  // The gene pre-check skips the carrier probe for rows of genes no case scored (2x on a WGS sort).
  // ponytail: keyed on the row's representative gene; a carrier annotated with another gene is
  // only seen by the page lookup. Probe every row if mixed-gene coordinates matter.
  return `(CASE WHEN ${alias}.gene_symbol IN (SELECT gene_symbol FROM ${table('case_phenotype_scores')})
    THEN (SELECT MAX(ps.score) ${carrierScoresFrom(dialect, table)}
    WHERE pv.chr = ${alias}.chr AND pv.pos = ${alias}.pos AND pv.ref = ${alias}.ref
      AND pv.alt = ${alias}.alt AND pv.variant_type = ${alias}.variant_type
      AND pc.genome_build = ${alias}.genome_build AND ${carrierRowSql('pv')}) END)`
}

/** Params: case id, the page's variant ids (a JSON array on SQLite). */
export function casePhenotypePageSql(dialect: SqlDialect, table: Table = plain): string {
  const caseId = dialect === 'postgres' ? '$1' : '?'
  const ids = dialect === 'postgres' ? '= ANY($2::bigint[])' : 'IN (SELECT value FROM json_each(?))'
  return `SELECT v.id AS variant_id, ps.score, ps.best_disease
    FROM ${table('variants')} v
    JOIN ${table('case_phenotype_scores')} ps
      ON ps.case_id = v.case_id AND ps.gene_symbol = v.gene_symbol
    WHERE v.case_id = ${caseId} AND v.id ${ids}`
}

/** Params: {@link cohortPhenotypePageParams}; rows are matched on identity by attach. */
export function cohortPhenotypePageSql(dialect: SqlDialect, table: Table = plain): string {
  const loci =
    dialect === 'postgres'
      ? 'SELECT * FROM unnest($1::text[], $2::bigint[])'
      : 'SELECT value ->> 0, value ->> 1 FROM json_each(?)'
  return `SELECT pv.chr, pv.pos, pv.ref, pv.alt, pv.variant_type, pc.genome_build,
      MAX(ps.score) AS score, COUNT(DISTINCT pv.case_id) AS carriers
    ${carrierScoresFrom(dialect, table)}
    WHERE (pv.chr, pv.pos) IN (${loci}) AND ${carrierRowSql('pv')}
    GROUP BY pv.chr, pv.pos, pv.ref, pv.alt, pv.variant_type, pc.genome_build`
}

/** The page's (chr, pos) loci: one JSON array on SQLite, two arrays on PostgreSQL. */
export function cohortPhenotypePageParams(
  dialect: SqlDialect,
  rows: Array<{ chr: string; pos: number }>
): unknown[] {
  const loci = [...new Map(rows.map((r) => [`${r.chr}:${r.pos}`, [r.chr, r.pos]])).values()]
  return dialect === 'postgres'
    ? [loci.map((l) => l[0]), loci.map((l) => l[1])]
    : [JSON.stringify(loci)]
}

/**
 * Set `phenotype_score` / `phenotype_disease` on every case row, null when the
 * gene has no stored score (the renderer reuses row objects across fetches).
 */
export function attachCasePhenotype(
  rows: Array<{ id: number; phenotype_score?: number | null; phenotype_disease?: string | null }>,
  hits: Array<{ variant_id: unknown; score: unknown; best_disease: unknown }>
): void {
  const byId = new Map(hits.map((h) => [Number(h.variant_id), h]))
  for (const row of rows) {
    const hit = byId.get(Number(row.id))
    row.phenotype_score = hit === undefined ? null : Number(hit.score)
    row.phenotype_disease = hit === undefined ? null : ((hit.best_disease as string | null) ?? null)
  }
}

const identityKey = (v: Record<keyof CohortVariantIdentity, unknown>): string =>
  [v.chr, Number(v.pos), v.ref, v.alt, v.variant_type, v.genome_build].map(String).join('\u0000')

/** Set `phenotype_score` and carrier hint (`phenotype_disease`) on every cohort row. */
export function attachCohortPhenotype(
  rows: Array<
    CohortVariantIdentity & { phenotype_score?: number | null; phenotype_disease?: string | null }
  >,
  hits: Array<
    Record<keyof CohortVariantIdentity, unknown> & { score: unknown; carriers?: number | string }
  >
): void {
  const byIdentity = new Map(hits.map((h) => [identityKey(h), h]))
  for (const row of rows) {
    const hit = byIdentity.get(identityKey(row))
    row.phenotype_score = hit === undefined ? null : Number(hit.score)
    const carriers = hit?.carriers === undefined ? 0 : Number(hit.carriers)
    if (carriers > 0) {
      row.phenotype_disease = `${carriers} ${carriers === 1 ? 'carrier' : 'carriers'} scored`
    } else if ('phenotype_disease' in row) {
      row.phenotype_disease = null
    }
  }
}
