/**
 * Write lock for the derived cohort tables of one workspace schema
 * (`cohort_variant_summary`, `cohort_gene_summary`,
 * `cohort_gene_variant_summary`, `variant_frequency`).
 *
 * Every writer of those tables takes it for the duration of its transaction:
 * an import's publication step, hiding a case for deletion, and a full
 * rebuild. That gives one writer at a time, so concurrent imports cannot
 * deadlock on overlapping variants, and a rebuild never interleaves with a
 * publication. Readers do not take it and are never blocked by it.
 *
 * Transaction-scoped advisory lock: released by COMMIT or ROLLBACK, so a
 * crashed or cancelled writer cannot leave it held.
 */
import type { PoolClient } from 'pg'

type Queryable = Pick<PoolClient, 'query'>

const LOCK_KEY_SQL = "hashtext($1), hashtext('varlens-summary-publish')"

const LOCK_POLL_START_MS = 25
const LOCK_POLL_MAX_MS = 250
/** Far longer than any publication or rebuild should hold the lock. */
const LOCK_WAIT_LIMIT_MS = 60 * 60 * 1000

/**
 * Wait for the write lock. Call inside a transaction.
 *
 * Polls with the non-blocking form instead of blocking in
 * `pg_advisory_xact_lock`: pooled connections carry a client-side query
 * timeout (30 s by default) that would kill a single long wait, and a waiter
 * blocked inside PostgreSQL also ignores cancellation of its job. Each poll
 * is a sub-millisecond query, so the wait survives any timeout setting.
 */
export async function lockSummaryForWrite(client: Queryable, schema: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS
  let delay = LOCK_POLL_START_MS
  while (!(await tryLockSummaryForWrite(client, schema))) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the cohort summary write lock of ${schema}`)
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(LOCK_POLL_MAX_MS, delay * 2)
  }
}

/** Take the write lock only if it is free. Call inside a transaction. */
export async function tryLockSummaryForWrite(client: Queryable, schema: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_xact_lock(${LOCK_KEY_SQL}) AS locked`,
    [schema]
  )
  // PostgreSQL always answers with exactly one row; only a `false` is a refusal.
  return result.rows[0]?.locked !== false
}
