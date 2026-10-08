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
 *
 * Lock order. PostgreSQL's deadlock detector does not see a writer polling
 * for this lock, so no writer may wait for it while it holds a row lock that
 * a holder of it can need:
 *   - import publication and `hideCase`: their own `cases_all` row first, in
 *     NO KEY UPDATE mode only, then this lock, then the derived tables;
 *   - rebuild and flags refresh: this lock, then the derived tables;
 *   - annotation save and transcript switch: this lock first (bounded wait,
 *     or not at all), then their rows. An annotation's foreign key takes a
 *     key-share lock on the case row, which NO KEY UPDATE does not block.
 * So: never take a case row FOR UPDATE, and no other row lock at all, before
 * waiting for this lock.
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
export async function lockSummaryForWrite(
  client: Queryable,
  schema: string,
  signalOrCancelled?: AbortSignal | (() => boolean)
): Promise<void> {
  const isCancelled =
    typeof signalOrCancelled === 'function'
      ? signalOrCancelled
      : () => signalOrCancelled?.aborted === true
  const deadline = Date.now() + LOCK_WAIT_LIMIT_MS
  let delay = LOCK_POLL_START_MS
  while (!(await tryLockSummaryForWrite(client, schema))) {
    if (isCancelled()) {
      throw new Error(`Cancelled while waiting for cohort summary write lock of ${schema}`)
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the cohort summary write lock of ${schema}`)
    }
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (isCancelled()) {
      throw new Error(`Cancelled while waiting for cohort summary write lock of ${schema}`)
    }
    delay = Math.min(LOCK_POLL_MAX_MS, delay * 2)
  }
}

/**
 * Wait for the write lock, but only for `waitMs`. Returns whether it was
 * taken. For an interactive write that must not queue behind a long lock
 * holder (a running rebuild, a batch of publications): on `false` the caller
 * commits its own change and leaves the derived tables to a later reconcile.
 */
export async function lockSummaryForWriteWithin(
  client: Queryable,
  schema: string,
  waitMs: number
): Promise<boolean> {
  const deadline = Date.now() + waitMs
  let delay = LOCK_POLL_START_MS
  for (;;) {
    if (await tryLockSummaryForWrite(client, schema)) return true
    const remaining = deadline - Date.now()
    if (remaining <= 0) return false
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, remaining)))
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
