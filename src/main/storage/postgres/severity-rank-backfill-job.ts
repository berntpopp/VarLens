/**
 * Background backfill of `impact_rank` / `clinvar_rank` on variant rows that
 * existed before migration 0025 (#469).
 *
 * The migration only adds the columns (NULL = not backfilled). Readers do not
 * depend on this job: they compute a missing rank on the fly
 * (cohort-summary-representative-sql.ts, carrierRanks). The job makes the
 * stored value catch up, so that fallback is eventually never taken.
 *
 * It walks the primary key in id ranges. Each batch is one short transaction
 * that updates only the rows of its range that still lack a rank, then
 * records how far it got in `severity_rank_backfill`: no table lock, no long
 * transaction, and a server that stops resumes at the recorded id. A
 * transaction-level advisory lock keeps two server processes from doing the
 * same batch. Like the background summary rebuild it is single-flight per
 * schema and backs off after a failure.
 */
import type { Pool, PoolClient } from 'pg'

import { impactRankCaseSql } from '../../../shared/config/severity.config'
import { mainLogger } from '../../services/MainLogger'
import { clinvarLookupRankSql } from './cohort-summary-representative-sql'

interface ScopedPool {
  pool: Pick<Pool, 'query' | 'connect'>
  schema: string
}

/** Ids per batch; a batch touches at most this many rows. */
export const SEVERITY_BACKFILL_BATCH_IDS = 20_000
/** Pause between batches, so the job never monopolises a connection or the WAL. */
const PAUSE_BETWEEN_BATCHES_MS = 25
const RETRY_BASE_MS = 5 * 60 * 1000
const RETRY_MAX_MS = 6 * 60 * 60 * 1000

export interface SeverityBackfillProgress {
  nextId: number
  maxId: number
  done: boolean
}

/**
 * Backfill one id range. Returns the progress afterwards, or null when
 * another process holds the batch lock right now.
 */
export async function runSeverityRankBackfillBatch(
  { pool, schema }: ScopedPool,
  batchIds = SEVERITY_BACKFILL_BATCH_IDS
): Promise<SeverityBackfillProgress | null> {
  const tbl = (table: string): string => `"${schema}"."${table}"`
  const client = (await pool.connect()) as PoolClient
  try {
    await client.query('BEGIN')
    const lock = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS locked',
      [`${schema}:severity_rank_backfill`]
    )
    if (lock.rows[0]?.locked !== true) {
      await client.query('ROLLBACK')
      return null
    }
    const state = await client.query<{ next_id: string; max_id: string; done: boolean }>(
      `SELECT next_id, max_id, completed_at IS NOT NULL AS done
         FROM ${tbl('severity_rank_backfill')} WHERE id = 1`
    )
    const row = state.rows[0]
    if (row === undefined || row.done) {
      await client.query('COMMIT')
      return { nextId: Number(row?.next_id ?? 0), maxId: Number(row?.max_id ?? 0), done: true }
    }
    const from = Number(row.next_id)
    const maxId = Number(row.max_id)
    const upTo = Math.min(from + batchIds, maxId)
    await client.query(
      `UPDATE ${tbl('variants_all')} v
          SET impact_rank = COALESCE(v.impact_rank, ${impactRankCaseSql('v.consequence')}),
              clinvar_rank = COALESCE(v.clinvar_rank, ${clinvarLookupRankSql('v', tbl('clinvar_severity'))})
        WHERE v.id > $1 AND v.id <= $2
          AND (v.impact_rank IS NULL OR v.clinvar_rank IS NULL)`,
      [from, upTo]
    )
    const done = upTo >= maxId
    await client.query(
      `UPDATE ${tbl('severity_rank_backfill')}
          SET next_id = $1, updated_at = now(),
              completed_at = CASE WHEN $2 THEN now() ELSE NULL END
        WHERE id = 1`,
      [upTo, done]
    )
    await client.query('COMMIT')
    return { nextId: upTo, maxId, done }
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

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runUntilDone(scope: ScopedPool): Promise<void> {
  for (;;) {
    const progress = await runSeverityRankBackfillBatch(scope)
    // Another process is on it: it will finish, or this one tries again later.
    if (progress === null) return
    if (progress.done) {
      completed.add(scope.schema)
      mainLogger.info(`Severity rank backfill of ${scope.schema} is complete`, 'cohort')
      return
    }
    await pause(PAUSE_BETWEEN_BATCHES_MS)
  }
}

const running = new Map<string, Promise<void>>()
const completed = new Set<string>()
const failures = new Map<string, { count: number; retryAt: number }>()

/**
 * Start the backfill of a schema in the background unless it is running,
 * known to be complete, or backing off after a failure. Cheap to call on
 * every cohort read.
 */
export function scheduleSeverityRankBackfill(scope: ScopedPool): void {
  if (completed.has(scope.schema) || running.has(scope.schema)) return
  const failed = failures.get(scope.schema)
  if (failed !== undefined && Date.now() < failed.retryAt) return

  const task = runUntilDone(scope)
    .then(() => {
      failures.delete(scope.schema)
    })
    .catch((error: unknown) => {
      const count = (failures.get(scope.schema)?.count ?? 0) + 1
      const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (count - 1))
      failures.set(scope.schema, { count, retryAt: Date.now() + wait })
      const message = error instanceof Error ? error.message : String(error)
      mainLogger.error(
        `Severity rank backfill of ${scope.schema} failed (attempt ${count}): ${message}. ` +
          `Ranks are still computed on read; next attempt in ${Math.round(wait / 60000)} min.`,
        'cohort'
      )
    })
    .finally(() => {
      running.delete(scope.schema)
    })
  running.set(scope.schema, task)
}

/** Test-only: await the in-flight backfill of a schema. */
export async function awaitSeverityRankBackfill(schema: string): Promise<void> {
  await running.get(schema)
}
