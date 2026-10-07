/**
 * Derived-data publication for one imported case, run inside the import
 * worker's single publication transaction (the caller owns BEGIN/COMMIT).
 *
 * Imports of one batch run in parallel but publish one at a time: every
 * writer of the derived cohort tables holds the summary write lock
 * (cohort-summary-lock.ts) until it commits. Whatever a publication does
 * while holding the lock is therefore the batch's throughput limit, so the
 * work is split in two:
 *
 *   before the lock  everything that reads only this case's own rows and
 *                    writes nothing shared: the per-case aggregates (into
 *                    session-local temporary tables) and the case's column
 *                    metadata
 *   under the lock   only the upserts into the shared tables, in a fixed
 *                    order: variant_frequency, cohort_variant_summary, the
 *                    gene aggregates
 *
 * Failure handling is unchanged. The frequency upsert is bookkeeping: its
 * failure fails the import. Summary maintenance is wrapped in savepoints: a
 * failure (while preparing or while upserting) rolls back to the savepoint
 * and marks the summary stale in this same transaction, so the case is still
 * published and the next cohort read rebuilds. Staleness is not surfaced on
 * ImportResult.
 */
import type { Client, PoolClient } from 'pg'

import { PostgresCohortSummaryRepository } from '../storage/postgres/PostgresCohortSummaryRepository'
import { rebuildVariantFrequencyForCase } from '../storage/postgres/PostgresJsonImportRepository'
import { profilePhase } from '../storage/postgres/postgres-import-profile'

type WorkerClient = Pick<Client, 'query'>
type SummaryScope = Parameters<PostgresCohortSummaryRepository['incrementalAdd']>[0]

interface PublicationArgs {
  client: WorkerClient
  schema: string
  caseId: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The lock-free half. Returns the error instead of throwing: the caller still
 * has to publish the case and record the summary as stale.
 */
async function prepareSummaryBeforeLock(
  summary: PostgresCohortSummaryRepository,
  scope: SummaryScope,
  client: WorkerClient
): Promise<{ error: unknown } | null> {
  try {
    await client.query('SAVEPOINT cohort_prepare')
    await profilePhase('pub-prepare', () => summary.prepareAdd(scope))
    await profilePhase('pub-column-meta', () => summary.refreshColumnMetas(scope))
    await client.query('RELEASE SAVEPOINT cohort_prepare')
    return null
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT cohort_prepare')
    return { error }
  }
}

/**
 * Keep stale marking in the caller's publication transaction. The case is
 * still hidden at this point, so committing here would create a crash window
 * in which derived rows exist without a recoverable publication marker.
 */
async function markSummaryStale(
  summary: PostgresCohortSummaryRepository,
  scope: SummaryScope,
  cause: unknown
): Promise<void> {
  try {
    await summary.markStale({
      schema: scope.schema,
      client: scope.client,
      reason: `post_import_summary_failed_case_${scope.caseId}`
    })
  } catch (markErr) {
    throw Object.assign(
      new Error(
        `Cohort summary update failed (${errorMessage(cause)}) and stale marking failed (${errorMessage(markErr)})`
      ),
      { cause: markErr }
    )
  }
  // Worker threads have no mainLogger; console.warn is the documented exception.
  console.warn(
    `[postgres-import-worker] Cohort summary update failed for case ${scope.caseId}; marked stale:`,
    errorMessage(cause)
  )
}

/**
 * Publish the derived data of one imported case. Call inside the publication
 * transaction, after the case's rows and its variant_count are written.
 * Throws only when the import must not be published.
 */
export async function publishDerivedDataForImport(
  args: PublicationArgs & {
    /** The case's rows are still provisional (VCF) or already visible (JSON). */
    frequencyIncludesProvisional: boolean
    /** Waits for the summary write lock; a cancel during the wait throws. */
    lockSummary: (client: Pick<PoolClient, 'query'>) => Promise<void>
  }
): Promise<void> {
  const { client, schema, caseId } = args
  const pooled = client as unknown as Pick<PoolClient, 'query'>
  const summary = new PostgresCohortSummaryRepository()
  const scope: SummaryScope = {
    schema,
    client: client as unknown as SummaryScope['client'],
    caseId,
    includeProvisional: true
  }

  const prepareFailure = await prepareSummaryBeforeLock(summary, scope, client)

  await profilePhase('pub-lock-wait', () => args.lockSummary(pooled))
  await profilePhase('pub-variant-frequency', () =>
    rebuildVariantFrequencyForCase(pooled, schema, caseId, args.frequencyIncludesProvisional)
  )

  if (prepareFailure !== null) {
    await markSummaryStale(summary, scope, prepareFailure.error)
    return
  }
  try {
    await client.query('SAVEPOINT cohort_summary')
    await profilePhase('pub-summary-add', () =>
      summary.incrementalAdd({ ...scope, prepared: true })
    )
    await client.query('RELEASE SAVEPOINT cohort_summary')
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT cohort_summary')
    await markSummaryStale(summary, scope, error)
  }
}
