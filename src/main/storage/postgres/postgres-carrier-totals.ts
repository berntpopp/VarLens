/**
 * Cached carrier-frequency denominators on PostgreSQL (#555). Computing them
 * probes every visible case once per variant class (an index seek each), on
 * every case and cohort query; at 10k cases that is ~40k seeks per query.
 * They change only when the summary or the set of visible cases does, which
 * {@link summaryVersionSql} tracks, so they are computed once per version and
 * inlined as a literal derived table (classTotalsValuesSql). No table.
 *
 * Per process and schema; a newer version (another process imported or
 * deleted a case) recomputes. Totals computed just after a write that the
 * version read missed are newer, never older, than their key.
 */
import type { Pool, PoolClient } from 'pg'

import { classTotalsValuesSql } from '../../../shared/sql/carrier-frequency'
import { quoteIdentifier, toNumber } from './identifiers'
import { liveCarrierTotalsSql } from './postgres-carrier-frequency-sql'

type Queryable = Pick<Pool | PoolClient, 'query'>
type Tbl = (table: string) => string

/**
 * Changes whenever the summary or the set of visible cases does: every
 * import, deletion and rebuild stamps cohort_summary_state, and the case
 * count moves with every published or hidden case.
 */
export function summaryVersionSql(tbl: Tbl): string {
  return `SELECT concat_ws('|', s.last_incremental_at, s.last_rebuilt_at,
                        (SELECT COUNT(*) FROM ${tbl('cases')})) AS version
         FROM ${tbl('cohort_summary_state')} s WHERE s.id = 1`
}

const cache = new Map<string, { version: string; sql: string }>()

/** The denominators of `schema` for its current summary version, as literal SQL. */
export async function carrierTotalsSql(pool: Queryable, schema: string): Promise<string> {
  const quoted = quoteIdentifier(schema)
  const tbl: Tbl = (table) => `${quoted}."${table}"`
  const versionRows = await pool.query<{ version: string }>(summaryVersionSql(tbl))
  const version = versionRows.rows[0]?.version ?? ''
  const hit = cache.get(schema)
  if (hit?.version === version) return hit.sql

  const totals = await pool.query<{ build: string; vclass: string; total: unknown }>(
    liveCarrierTotalsSql(tbl)
  )
  const sql = classTotalsValuesSql(
    totals.rows.map((row) => ({ build: row.build, vclass: row.vclass, total: toNumber(row.total) }))
  )
  cache.set(schema, { version, sql })
  return sql
}
