/**
 * Per-member family calls (`family_calls`) for one page of case variant rows
 * (#628): one query per page when an analysis group is active, shared by
 * SQLite and PostgreSQL.
 */
import type { SqlDialect } from './chromosome-order'
import { resolvedGtSql } from './genotype-dosage'

type Table = (name: string) => string
const plain: Table = (name) => name

export interface FamilyCall {
  role: string
  gt_num: string | null
  gq: number | null
  dp: number | null
}

export interface FamilyCallHit {
  variant_id: unknown
  member_case_id: unknown
  role: unknown
  gt_num: unknown
  gq: unknown
  dp: unknown
}

/**
 * Params: groupId, caseId, the page's variant ids (a JSON array on SQLite,
 * a bigint[] on PostgreSQL).
 */
export function familyCallsPageSql(dialect: SqlDialect, table: Table = plain): string {
  const p1 = dialect === 'postgres' ? '$1' : '?'
  const p2 = dialect === 'postgres' ? '$2' : '?'
  const idPred =
    dialect === 'postgres' ? '= ANY($3::bigint[])' : 'IN (SELECT value FROM json_each(?))'
  return `SELECT p.id AS variant_id, agm.case_id AS member_case_id, agm.role AS role,
           ${resolvedGtSql('m.gt_num', dialect)} AS gt_num,
           MAX(m.gq) AS gq, MAX(m.dp) AS dp
    FROM ${table('variants')} p
    JOIN ${table('analysis_group_members')} agm
      ON agm.group_id = ${p1} AND agm.case_id <> p.case_id
    LEFT JOIN ${table('variants')} m
      ON m.case_id = agm.case_id
     AND m.chr = p.chr AND m.pos = p.pos AND m.ref = p.ref AND m.alt = p.alt
    WHERE p.case_id = ${p2} AND p.id ${idPred}
    GROUP BY p.id, agm.case_id, agm.role`
}

/**
 * Set `family_calls` (`{ [member_case_id]: { role, gt_num, gq, dp } }`) on
 * every row of the page.
 */
export function attachFamilyCalls(
  rows: Array<{ id: number; family_calls?: Record<number, FamilyCall> }>,
  hits: readonly FamilyCallHit[]
): void {
  const byVariant = new Map<number, Record<number, FamilyCall>>()
  for (const hit of hits) {
    const vid = Number(hit.variant_id)
    let calls = byVariant.get(vid)
    if (calls === undefined) {
      calls = {}
      byVariant.set(vid, calls)
    }
    calls[Number(hit.member_case_id)] = {
      role: String(hit.role),
      gt_num: (hit.gt_num as string | null) ?? null,
      gq: hit.gq == null ? null : Number(hit.gq),
      dp: hit.dp == null ? null : Number(hit.dp)
    }
  }
  for (const row of rows) {
    row.family_calls = byVariant.get(Number(row.id)) ?? {}
  }
}
