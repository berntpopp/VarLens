/**
 * Tag ids for one page of table rows (#125): one lookup per page, never per
 * row. The case table reads the case's own assignments; the cohort table reads
 * the tags of every ready carrier case of the row's variant (read-only there).
 * Both backends run the same SQL and attach the result with the same helpers.
 */
import type { CohortVariantIdentity } from '../types/cohort'
import type { SqlDialect } from './chromosome-order'

type Table = (name: string) => string
const plain: Table = (name) => name

/** Params: case id, the page's variant ids (a JSON array on SQLite). */
export function caseTagIdsSql(dialect: SqlDialect, table: Table = plain): string {
  const ids = dialect === 'postgres' ? '= ANY($2::bigint[])' : 'IN (SELECT value FROM json_each(?))'
  const caseId = dialect === 'postgres' ? '$1' : '?'
  return `SELECT variant_id, tag_id FROM ${table('variant_tags')}
           WHERE case_id = ${caseId} AND variant_id ${ids}
           ORDER BY tag_id`
}

/**
 * Params: the page's positions (a JSON array on SQLite). The rows are matched
 * on their full identity by {@link attachCohortTagIds}. `variant_tags` holds
 * only what users tagged, so the join stays small.
 */
export function cohortTagIdsSql(dialect: SqlDialect, table: Table = plain): string {
  const positions =
    dialect === 'postgres' ? '= ANY($1::bigint[])' : 'IN (SELECT value FROM json_each(?))'
  // Same carrier scope as cohortCarriersSql: SQLite skips cases not yet ready.
  const ready = dialect === 'sqlite' ? "c.import_status = 'ready' AND " : ''
  return `SELECT DISTINCT v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build, vt.tag_id
            FROM ${table('variant_tags')} vt
            JOIN ${table('variants')} v ON v.id = vt.variant_id
            JOIN ${table('cases')} c ON c.id = vt.case_id
           WHERE ${ready}v.pos ${positions}
           ORDER BY vt.tag_id`
}

/** SQLite binds the id list as JSON, PostgreSQL as an array. */
export function idListParam(dialect: SqlDialect, values: number[]): number[] | string {
  return dialect === 'postgres' ? values : JSON.stringify(values)
}

type TagHit = { tag_id: unknown }

function groupTagIds<H extends TagHit>(
  hits: H[],
  keyOf: (hit: H) => string
): Map<string, number[]> {
  const byKey = new Map<string, number[]>()
  for (const hit of hits) {
    const key = keyOf(hit)
    const tagId = Number(hit.tag_id)
    const ids = byKey.get(key)
    if (ids === undefined) byKey.set(key, [tagId])
    else if (!ids.includes(tagId)) ids.push(tagId)
  }
  return byKey
}

/**
 * Set `tag_ids` on every case row, `[]` when untagged: the renderer reuses row
 * objects across fetches, so an absent field would keep a stale value.
 */
export function attachCaseTagIds(
  rows: Array<{ id: number; tag_ids?: number[] }>,
  hits: Array<{ variant_id: unknown; tag_id: unknown }>
): void {
  const byId = groupTagIds(hits, (hit) => String(Number(hit.variant_id)))
  for (const row of rows) {
    row.tag_ids = byId.get(String(row.id)) ?? []
  }
}

const identityKey = (v: {
  chr: unknown
  pos: unknown
  ref: unknown
  alt: unknown
  variant_type: unknown
  genome_build: unknown
}): string =>
  [v.chr, Number(v.pos), v.ref, v.alt, v.variant_type, v.genome_build].map(String).join('\u0000')

/** Set `tag_ids` on every cohort row: the tags its carrier cases gave it. */
export function attachCohortTagIds(
  rows: Array<CohortVariantIdentity & { tag_ids?: number[] }>,
  hits: Array<Record<keyof CohortVariantIdentity, unknown> & TagHit>
): void {
  const byIdentity = groupTagIds(hits, identityKey)
  for (const row of rows) {
    row.tag_ids = byIdentity.get(identityKey(row)) ?? []
  }
}

/** Distinct positions of a page, the cohort lookup's parameter. */
export function pagePositions(rows: Array<{ pos: number }>): number[] {
  return [...new Set(rows.map((row) => row.pos))]
}
