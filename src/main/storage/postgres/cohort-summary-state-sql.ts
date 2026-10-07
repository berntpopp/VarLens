/**
 * Sprint A PR-3 C1 — cohort_summary_state lifecycle helpers.
 *
 * Free functions extracted from PostgresCohortSummaryRepository so the
 * repository file stays under the 600-line LLM-sustainable threshold. The
 * repository keeps thin instance methods that delegate here; callers continue
 * to use repo.getState / repo.markStale (Pass-7 MED #4 + Pass-8 #7 + Pass-9 #6).
 */
import type { PoolClient } from 'pg'

interface ScopedClient {
  schema: string
  client: PoolClient
}

/**
 * Return the singleton lifecycle state in the existing IPC shape
 * { is_stale, last_rebuilt_at:number } (Pass-7 MED #4 + Pass-8 #7). The
 * TIMESTAMPTZ last_rebuilt_at maps to epoch milliseconds via
 * EXTRACT(EPOCH FROM …) * 1000 (Pass-9 #6); a NULL (never rebuilt) coalesces
 * to 0 to keep the contract numeric.
 */
export async function getCohortSummaryState({
  schema,
  client
}: ScopedClient): Promise<{ is_stale: boolean; last_rebuilt_at: number }> {
  const tbl = (t: string): string => `"${schema}"."${t}"`
  const r = await client.query<{ is_stale: boolean; last_rebuilt_at: string }>(
    `SELECT ${summaryIsStaleSql(tbl, 'cohort_summary_state')} AS is_stale,
            COALESCE(EXTRACT(EPOCH FROM last_rebuilt_at) * 1000, 0)::bigint AS last_rebuilt_at
     FROM ${tbl('cohort_summary_state')}
     WHERE id = 1`
  )
  const row = r.rows[0]
  return { is_stale: row.is_stale, last_rebuilt_at: Number(row.last_rebuilt_at) }
}

/**
 * Flag the summary stale with an explicit reason (Pass-7 MED #4). Leaves
 * last_rebuilt_at untouched so rebuild history is preserved; the next cohort
 * read sees is_stale=true and triggers a rebuild.
 */
export async function markCohortSummaryStale({
  schema,
  client,
  reason
}: ScopedClient & { reason: string }): Promise<void> {
  const tbl = (t: string): string => `"${schema}"."${t}"`
  await client.query(
    `UPDATE ${tbl('cohort_summary_state')}
     SET is_stale = true, stale_reason = $1, stale_at = now()
     WHERE id = 1`,
    [reason]
  )
}

/**
 * Whether the summary needs a rebuild: flagged stale on its state row, or a
 * writer that could not get the summary write lock left a rebuild request
 * (see {@link requestSummaryRebuild}). `stateAlias` names the state row.
 */
export function summaryIsStaleSql(tbl: (t: string) => string, stateAlias: string): string {
  return `(${stateAlias}.is_stale OR EXISTS (SELECT 1 FROM ${tbl('cohort_summary_rebuild_requests')}))`
}

/**
 * Ask for a rebuild without the summary write lock. The state row cannot be
 * used for this: the lock holder updates it, so marking it stale would wait
 * for that holder to commit. An inserted request row waits for nobody.
 * `rebuild()` consumes the requests it can see; one that commits later
 * survives and triggers another rebuild, so no change is ever missed.
 *
 * Only a visible variant has summary rows: for any other this is a no-op.
 */
export async function requestSummaryRebuildForVariant(args: {
  schema: string
  client: Pick<PoolClient, 'query'>
  variantId: number
  reason: string
}): Promise<void> {
  const tbl = (t: string): string => `"${args.schema}"."${t}"`
  await args.client.query(
    `INSERT INTO ${tbl('cohort_summary_rebuild_requests')} (reason)
     SELECT $2 WHERE EXISTS (SELECT 1 FROM ${tbl('variants')} WHERE id = $1)`,
    [args.variantId, args.reason]
  )
}

/** Called by rebuild() before it reads the variants. */
export async function consumeSummaryRebuildRequests(args: {
  schema: string
  client: Pick<PoolClient, 'query'>
}): Promise<void> {
  await args.client.query(`DELETE FROM "${args.schema}"."cohort_summary_rebuild_requests"`)
}
