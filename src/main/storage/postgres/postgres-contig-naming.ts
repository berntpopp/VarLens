/**
 * PostgreSQL chromosome names per build (spec:
 * .planning/specs/2026-10-12-chr-naming-per-build.md; SQLite twin:
 * database/contig-naming-migration.ts + contig-rename-sqlite.ts).
 *
 * Migration 0030 queues every existing case in `contig_naming_pending`; a
 * build the user confirms queues the case again (`confirmed`). This
 * background job works through the queue in short transactions, each taking
 * its rows with FOR UPDATE SKIP LOCKED so two servers never do the same work:
 *   1. plan one case: re-check its build (or take the confirmed one) and store
 *      the renames, or flag it for the user;
 *   2. once every queued case is planned, rename one case per transaction,
 *      its global annotations with it (postgres-contig-rename.ts), and dequeue it.
 * A crash rolls back the step in flight and the next run resumes there. The
 * cohort summary is asked for one rebuild, by the step that empties the queue.
 * Single-flight per schema per process, with back-off after a failure.
 */
import type { Pool, PoolClient } from 'pg'

import {
  contigRenamePairs,
  planCaseContigNaming,
  type ContigRename
} from '../../../shared/genome/contig-naming-plan'
import { readVcfHeaderLines } from '../../import/vcf/read-vcf-header'
import { mainLogger } from '../../services/MainLogger'
import { renameCaseWithAnnotations } from './postgres-contig-rename'

type QueryClient = Pick<PoolClient, 'query'>
interface ScopedPool {
  pool: Pick<Pool, 'connect'>
  schema: string
}

const tblOf = (schema: string) => (table: string) => `"${schema}"."${table}"`

/** Stored names and max positions of a case, for the planner. */
export async function caseContigs(
  client: QueryClient,
  schema: string,
  caseId: number
): Promise<Array<{ chr: string; maxPos: number }>> {
  const rows = await client.query<{ chr: string; max_pos: string }>(
    `SELECT chr, MAX(pos) AS max_pos FROM ${tblOf(schema)('variants_all')}
      WHERE case_id = $1 GROUP BY chr`,
    [caseId]
  )
  return rows.rows.map((r) => ({ chr: r.chr, maxPos: Number(r.max_pos) }))
}

/** One rebuild of the cohort summary, asked by the step that empties the queue. */
async function requestRebuildWhenDone(client: QueryClient, schema: string): Promise<void> {
  const tbl = tblOf(schema)
  await client.query(
    `INSERT INTO ${tbl('cohort_summary_rebuild_requests')} (reason)
     SELECT 'contig_naming' WHERE NOT EXISTS (SELECT 1 FROM ${tbl('contig_naming_pending')})`
  )
}

/** Phase 1: plan one unplanned case. False when none is free. */
async function planOneCase(client: QueryClient, schema: string): Promise<boolean> {
  const tbl = tblOf(schema)
  const next = await client.query<{
    case_id: string
    confirmed: boolean
    genome_build: string | null
    file_path: string | null
  }>(
    `SELECT p.case_id, p.confirmed, c.genome_build, c.file_path
       FROM ${tbl('contig_naming_pending')} p JOIN ${tbl('cases_all')} c ON c.id = p.case_id
      WHERE p.pairs IS NULL ORDER BY p.case_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`
  )
  const row = next.rows[0]
  if (row === undefined) return false
  const caseId = Number(row.case_id)
  const genomeBuild = row.genome_build ?? ''
  const contigs = await caseContigs(client, schema, caseId)
  const pairs = contigRenamePairs(
    contigs.map((c) => c.chr),
    genomeBuild
  )
  const dequeue = async (): Promise<void> => {
    await client.query(`DELETE FROM ${tbl('contig_naming_pending')} WHERE case_id = $1`, [caseId])
    // A confirmed build may have changed without a rename: the summary is keyed by build.
    if (row.confirmed) await requestRebuildWhenDone(client, schema)
  }
  // A case already in its build's form: nothing is read or written.
  if (pairs.length === 0) {
    await dequeue()
    return true
  }
  const plan = row.confirmed
    ? ({ action: 'rename', pairs } as const)
    : planCaseContigNaming({
        genomeBuild,
        contigs,
        headerLines: await readVcfHeaderLines(row.file_path)
      })
  if (plan.action === 'rename') {
    await client.query(`UPDATE ${tbl('contig_naming_pending')} SET pairs = $2 WHERE case_id = $1`, [
      caseId,
      JSON.stringify(plan.pairs)
    ])
    return true
  }
  if (plan.action === 'flag') {
    await client.query(
      `INSERT INTO ${tbl('contig_build_review')} (case_id, stored_build, suggested_build, reason, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (case_id) DO NOTHING`,
      [caseId, genomeBuild, plan.suggestedBuild, plan.reason, Date.now()]
    )
  }
  await dequeue()
  return true
}

/**
 * Phase 2: rename one planned case, its notes in the same transaction. Waits
 * until every queued case is planned, so a swap partner's renames are known.
 */
async function renameOneCase(client: QueryClient, schema: string): Promise<boolean> {
  const tbl = tblOf(schema)
  const unplanned = await client.query(
    `SELECT 1 FROM ${tbl('contig_naming_pending')} WHERE pairs IS NULL LIMIT 1`
  )
  if (unplanned.rows.length > 0) return false // another process is still planning
  const next = await client.query<{ case_id: string; pairs: ContigRename[] }>(
    `SELECT case_id, pairs FROM ${tbl('contig_naming_pending')}
      ORDER BY case_id LIMIT 1 FOR UPDATE SKIP LOCKED`
  )
  const row = next.rows[0]
  if (row === undefined) return false
  const caseId = Number(row.case_id)
  await renameCaseWithAnnotations(client, schema, caseId, row.pairs)
  await client.query(`DELETE FROM ${tbl('contig_naming_pending')} WHERE case_id = $1`, [caseId])
  await requestRebuildWhenDone(client, schema)
  return true
}

/** Run one step (one short transaction). Returns false when nothing is left to do here. */
export async function runContigNamingStep({ pool, schema }: ScopedPool): Promise<boolean> {
  const client = (await pool.connect()) as PoolClient
  try {
    await client.query('BEGIN')
    const worked = (await planOneCase(client, schema)) || (await renameOneCase(client, schema))
    await client.query('COMMIT')
    return worked
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // surface the original error below
    }
    throw error
  } finally {
    client.release()
  }
}

const RETRY_BASE_MS = 5 * 60 * 1000
const RETRY_MAX_MS = 6 * 60 * 60 * 1000
const running = new Map<string, Promise<void>>()
const completed = new Set<string>()
const failures = new Map<string, { count: number; retryAt: number }>()

async function runUntilDone(scope: ScopedPool): Promise<void> {
  let steps = 0
  while (await runContigNamingStep(scope)) steps++
  completed.add(scope.schema)
  if (steps > 0) {
    mainLogger.info(`Chromosome-name update of ${scope.schema}: ${steps} step(s) done`, 'cohort')
  }
}

/**
 * Start the job for a schema unless it runs, is complete or backs off after
 * a failure. Cheap to call on every cohort read. `requeued`: the user queued
 * cases again (confirmed builds), so a completed schema runs once more.
 */
export function scheduleContigNaming(scope: ScopedPool, requeued = false): void {
  if (requeued) {
    completed.delete(scope.schema)
    failures.delete(scope.schema)
  }
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
      mainLogger.error(
        `Chromosome-name update of ${scope.schema} failed (attempt ${count}): ${error instanceof Error ? error.message : String(error)}; next attempt in ${Math.round(wait / 60000)} min.`,
        'cohort'
      )
    })
    .finally(() => {
      running.delete(scope.schema)
    })
  running.set(scope.schema, task)
}

/** The job of this schema failed and waits for its next attempt. */
export function contigNamingFailed(schema: string): boolean {
  return failures.has(schema)
}

/** Test-only: await the in-flight job of a schema. */
export async function awaitContigNaming(schema: string): Promise<void> {
  await running.get(schema)
}
