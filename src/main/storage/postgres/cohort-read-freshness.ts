/**
 * Sprint A PR-3 C5 (PR3-17) — cohort-read freshness / staleness orchestration.
 *
 * The cohort read path (cohort:query) must reconcile the materialised
 * cohort_variant_summary with its lifecycle state before serving rows:
 *
 *   - A summary that imports and deletions maintain incrementally is valid.
 *     It is never rebuilt just because no full rebuild has run yet: every
 *     write path either updates it or marks it stale in the same transaction.
 *   - Bootstrap-on-existing-data (Pass-9 #5): when variants exist but the
 *     summary table is empty, or a never-rebuilt summary is flagged stale (the
 *     0010 seed for databases that already held variants), or the per-gene
 *     aggregates are empty although the summary has genes, rebuild regardless
 *     of the case-count threshold — otherwise the first read of a migrated
 *     dataset would serve an empty cohort.
 *   - Stale below SYNC_REBUILD_MAX_CASES: rebuild synchronously, then serve
 *     fresh data (no warning).
 *   - Stale at/above the threshold: serve the stale summary immediately and
 *     schedule a single-flight background rebuild, surfacing
 *     warnings.staleSummary=true so the renderer can show a "refreshing" hint
 *     (Pass-8 #6).
 *
 * A rebuild takes the summary write lock (./cohort-summary-lock). A request
 * never waits for it: if an import is publishing, the read serves the rows it
 * has, warns staleSummary, and the rebuild runs in the background once the
 * lock is free.
 *
 * Free functions (pool + schema in) so PostgresCohortRepository stays an
 * orchestration-only repository and this read-path policy lives in one module.
 */
import type { Pool, PoolClient } from 'pg'

import { mainLogger } from '../../services/MainLogger'
import { PostgresCohortSummaryRepository } from './PostgresCohortSummaryRepository'
import { lockSummaryForWrite, tryLockSummaryForWrite } from './cohort-summary-lock'
import { getCohortSummaryState } from './cohort-summary-state-sql'

const DEFAULT_SYNC_REBUILD_MAX_CASES = 50
/** A background rebuild of a large cohort may legitimately run this long. */
const BACKGROUND_REBUILD_STATEMENT_TIMEOUT_MS = 30 * 60 * 1000

interface ScopedPool {
  pool: Pick<Pool, 'query' | 'connect'>
  schema: string
}

/** Optional warnings returned alongside a cohort read result. */
export interface CohortReadWarnings {
  staleSummary?: boolean
}

/**
 * Max total cases for which a stale-triggered rebuild still runs synchronously
 * on the read path. Reads from VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES; falls
 * back to 50. Read lazily (not cached) so tests can flip the env per-case.
 */
export function syncRebuildMaxCases(): number {
  const raw = process.env.VARLENS_PG_COHORT_SUMMARY_SYNC_MAX_CASES
  if (raw === undefined || raw.trim() === '') return DEFAULT_SYNC_REBUILD_MAX_CASES
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SYNC_REBUILD_MAX_CASES
}

/**
 * Read the cohort_summary_state singleton in the existing IPC contract shape
 * { is_stale, last_rebuilt_at:number } (Pass-9 #6 epoch-ms mapping). Connects a
 * client because getCohortSummaryState takes a PoolClient.
 */
export async function readCohortSummaryStatus({
  pool,
  schema
}: ScopedPool): Promise<{ is_stale: boolean; last_rebuilt_at: number }> {
  const client = await pool.connect()
  try {
    return await getCohortSummaryState({ schema, client })
  } finally {
    client.release()
  }
}

interface FreshnessProbe {
  never_rebuilt: boolean
  variants_present: boolean
  summary_present: boolean
  gene_summary_missing: boolean
  is_stale: boolean
  total_cases: number
}

async function probeFreshness({ pool, schema }: ScopedPool): Promise<FreshnessProbe> {
  const tbl = (t: string): string => `"${schema}"."${t}"`
  const result = await pool.query<{
    never_rebuilt: boolean
    variants_present: boolean
    summary_present: boolean
    gene_summary_missing: boolean
    is_stale: boolean
    total_cases: string
  }>(
    `SELECT
       (s.last_rebuilt_at IS NULL) AS never_rebuilt,
       EXISTS (SELECT 1 FROM ${tbl('variants')} LIMIT 1) AS variants_present,
       EXISTS (SELECT 1 FROM ${tbl('cohort_variant_summary')} LIMIT 1) AS summary_present,
       (NOT EXISTS (SELECT 1 FROM ${tbl('cohort_gene_summary')} LIMIT 1)
        AND EXISTS (SELECT 1 FROM ${tbl('cohort_variant_summary')}
                     WHERE gene_symbol IS NOT NULL LIMIT 1)) AS gene_summary_missing,
       s.is_stale,
       (SELECT COUNT(*)::bigint FROM ${tbl('cases')}) AS total_cases
     FROM ${tbl('cohort_summary_state')} s
     WHERE s.id = 1`
  )
  const row = result.rows[0]
  return {
    never_rebuilt: row.never_rebuilt,
    variants_present: row.variants_present,
    summary_present: row.summary_present,
    gene_summary_missing: row.gene_summary_missing,
    is_stale: row.is_stale,
    total_cases: Number(row.total_cases)
  }
}

/**
 * Run a single rebuild inside its own transaction (BEGIN/COMMIT).
 *
 * `wait: false` is the request path: it gives up immediately, returning
 * false, when another writer holds the summary lock. `wait: true` is the
 * background path: it queues for the lock with the session's lock and
 * statement timeouts lifted.
 */
async function runRebuild({ pool, schema }: ScopedPool, wait: boolean): Promise<boolean> {
  const repository = new PostgresCohortSummaryRepository()
  const client = (await pool.connect()) as PoolClient
  try {
    await client.query('BEGIN')
    if (wait) {
      await client.query('SET LOCAL lock_timeout = 0')
      await client.query(`SET LOCAL statement_timeout = ${BACKGROUND_REBUILD_STATEMENT_TIMEOUT_MS}`)
      await lockSummaryForWrite(client, schema)
    } else if (!(await tryLockSummaryForWrite(client, schema))) {
      await client.query('ROLLBACK')
      return false
    }
    await repository.rebuild({ schema, client })
    await client.query('COMMIT')
    return true
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback failure; surface the original error below
    }
    throw error
  } finally {
    client.release()
  }
}

/**
 * Single-flight gate per schema so concurrent stale reads schedule at most one
 * detached background rebuild. The promise is cleared when the rebuild settles.
 */
const backgroundRebuilds = new Map<string, Promise<void>>()

function scheduleBackgroundRebuild(scope: ScopedPool): void {
  if (backgroundRebuilds.has(scope.schema)) return

  const task = runRebuild(scope, true)
    .then(() => undefined)
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      mainLogger.warn(`Background cohort summary rebuild failed: ${message}`, 'cohort')
    })
    .finally(() => {
      backgroundRebuilds.delete(scope.schema)
    })
  backgroundRebuilds.set(scope.schema, task)
}

/**
 * Reconcile the cohort summary before serving a cohort read. Returns the
 * warnings to merge into the read response (staleSummary when a stale summary is
 * served without a synchronous refresh).
 */
export async function prepareCohortRead(
  scope: ScopedPool
): Promise<{ warnings?: CohortReadWarnings }> {
  const probe = await probeFreshness(scope)

  // Pass-9 #5: bootstrap-on-existing-data — rebuild irrespective of the
  // case-count threshold so the first read never serves an empty/missing
  // summary for a populated dataset. A summary that was only ever maintained
  // incrementally (never rebuilt, not stale) is valid and is served as-is.
  // The per-gene aggregates (cohort-gene-summary-sql.ts) are part of the same
  // summary: variants with a gene but no gene rows means they were never
  // filled (migration 0023 fills them; this covers a partial restore).
  const needsBootstrap =
    (probe.variants_present && !probe.summary_present) ||
    (probe.never_rebuilt && probe.is_stale) ||
    probe.gene_summary_missing
  const needsRebuild = needsBootstrap || probe.is_stale
  if (!needsRebuild) return {}

  const rebuildNow = needsBootstrap || probe.total_cases < syncRebuildMaxCases()
  if (rebuildNow && (await runRebuild(scope, false))) return {}

  // Large cohort, or an import is publishing right now: serve what is there
  // and refresh in the background.
  scheduleBackgroundRebuild(scope)
  return { warnings: { staleSummary: true } }
}

/** Test-only: await any in-flight background rebuild for a schema. */
export async function awaitBackgroundRebuild(schema: string): Promise<void> {
  await backgroundRebuilds.get(schema)
}
