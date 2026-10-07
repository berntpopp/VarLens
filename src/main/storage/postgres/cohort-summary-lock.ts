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

/** Wait for the write lock. Call inside a transaction. */
export async function lockSummaryForWrite(client: Queryable, schema: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(${LOCK_KEY_SQL})`, [schema])
}

/** Take the write lock only if it is free. Call inside a transaction. */
export async function tryLockSummaryForWrite(client: Queryable, schema: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_xact_lock(${LOCK_KEY_SQL}) AS locked`,
    [schema]
  )
  return result.rows[0]?.locked === true
}
