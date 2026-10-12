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
 *   2. once every queued case is planned, move the global annotations of all
 *      planned cases at once, from the final names (annotation-remap.ts);
 *   3. rename one case's variants per transaction and dequeue it.
 * A crash rolls back the step in flight and the next run resumes there. The
 * cohort summary is asked for one rebuild, by the step that empties the queue.
 * Single-flight per schema per process, with back-off after a failure.
 */
import type { Pool, PoolClient } from 'pg'

import { serializeAuditContractValue } from '../../../shared/audit/audit-contract'
import {
  annotationGroupKey,
  remapAnnotationGroup,
  type AnnotationRow
} from '../../../shared/genome/annotation-remap'
import {
  contigRenamePairs,
  planCaseContigNaming,
  type ContigRename
} from '../../../shared/genome/contig-naming-plan'
import { contigQueryNames } from '../../../shared/utils/contig'
import { readVcfHeaderLines } from '../../import/vcf/read-vcf-header'
import { mainLogger } from '../../services/MainLogger'
import { rebuildVariantFrequencyForCase } from './PostgresJsonImportRepository'

type QueryClient = Pick<PoolClient, 'query'>
interface ScopedPool {
  pool: Pick<Pool, 'connect'>
  schema: string
}

export const CONTIG_MIGRATION_USER = 'VarLens chromosome-name migration'
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

const toRow = (r: Record<string, unknown>): AnnotationRow => ({
  id: Number(r.id),
  chr: String(r.chr),
  pos: Number(r.pos),
  ref: String(r.ref),
  alt: String(r.alt),
  global_comment: (r.global_comment as string | null) ?? null,
  starred: Number(r.starred),
  acmg_classification: (r.acmg_classification as string | null) ?? null,
  acmg_evidence: (r.acmg_evidence as string | null) ?? null,
  created_at: Number(r.created_at),
  updated_at: Number(r.updated_at)
})

/**
 * Move, copy and merge the global annotations for every planned rename, per
 * locus group from the final names. Locks the rows it reads (FOR UPDATE), so a
 * concurrent edit is either seen here or waits and lands on the new row.
 */
export async function remapGlobalAnnotationsPg(
  client: QueryClient,
  schema: string,
  renames: ReadonlyMap<number, readonly ContigRename[]>
): Promise<void> {
  const tbl = tblOf(schema)
  const froms = new Set([...renames.values()].flatMap((pairs) => pairs.map((p) => p.from)))
  if (froms.size === 0) return
  const newName = (caseId: number, chr: string): string =>
    renames.get(caseId)?.find((p) => p.from === chr)?.to ?? chr
  const spellings = [...new Set([...froms].flatMap((f) => [f, ...contigQueryNames(f)]))]
  const locked = await client.query(
    `SELECT * FROM ${tbl('variant_annotations')} WHERE chr = ANY($1::text[]) ORDER BY id FOR UPDATE`,
    [spellings]
  )
  const groups = new Map<string, AnnotationRow[]>()
  for (const raw of locked.rows as Array<Record<string, unknown>>) {
    const row = toRow(raw)
    const key = annotationGroupKey(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  for (const group of groups.values()) {
    if (!group.some((r) => froms.has(r.chr))) continue
    const names = [...new Set(group.flatMap((r) => [r.chr, ...contigQueryNames(r.chr)]))]
    const { pos, ref, alt } = group[0]
    const usages = await client.query<{ case_id: string; chr: string }>(
      `SELECT DISTINCT case_id, chr FROM ${tbl('variants_all')}
        WHERE chr = ANY($1::text[]) AND pos = $2 AND ref = $3 AND alt = $4`,
      [names, pos, ref, alt]
    )
    const remap = remapAnnotationGroup(
      group,
      usages.rows.map((u) => ({ caseId: Number(u.case_id), chr: u.chr })),
      newName
    )
    if (remap === null) continue
    if (remap.deleteIds.length > 0) {
      await client.query(`DELETE FROM ${tbl('variant_annotations')} WHERE id = ANY($1::bigint[])`, [
        remap.deleteIds
      ])
    }
    for (const r of remap.inserts) {
      await client.query(
        `INSERT INTO ${tbl('variant_annotations')} (chr, pos, ref, alt, global_comment, starred,
           acmg_classification, acmg_evidence, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          r.chr,
          r.pos,
          r.ref,
          r.alt,
          r.global_comment,
          r.starred,
          r.acmg_classification,
          r.acmg_evidence,
          r.created_at,
          r.updated_at
        ]
      )
    }
    for (const a of remap.audits) {
      await client.query(
        `INSERT INTO varlens_audit."audit_log"
           (project_schema, action_type, entity_type, entity_key, old_value, new_value, user_name)
         VALUES ($1, 'acmg_classify', 'variant_annotation', $2, $3, $4, $5)`,
        [
          schema,
          a.key,
          serializeAuditContractValue(JSON.stringify({ acmg_classification: a.discarded })),
          serializeAuditContractValue(
            JSON.stringify({ acmg_classification: a.kept, reason: `contig_merge of ${a.from}` })
          ),
          CONTIG_MIGRATION_USER
        ]
      )
    }
  }
}

/**
 * Rename one case's variants and recount its frequencies, in the caller's
 * transaction. Only rows under an old name are written.
 */
export async function renameCaseVariantsPg(
  client: QueryClient,
  schema: string,
  caseId: number,
  pairs: readonly ContigRename[]
): Promise<void> {
  if (pairs.length === 0) return
  const tbl = tblOf(schema)
  const visible =
    (await client.query(`SELECT 1 FROM ${tbl('cases')} WHERE id = $1`, [caseId])).rows.length > 0
  // variant_frequency counts visible cases: the same decrement as a case delete.
  const caseCoords = `SELECT DISTINCT coord_hash FROM ${tbl('variants_all')} WHERE case_id = $1`
  if (visible) {
    await client.query(
      `UPDATE ${tbl('variant_frequency')} vf SET case_count = vf.case_count - 1
         FROM (${caseCoords}) coords WHERE vf.coord_hash = coords.coord_hash`,
      [caseId]
    )
  }
  for (const pair of pairs) {
    await client.query(
      `UPDATE ${tbl('variants_all')} SET chr = $1 WHERE case_id = $2 AND chr = $3`,
      [pair.to, caseId, pair.from]
    )
  }
  if (visible) {
    await rebuildVariantFrequencyForCase(client, schema, caseId)
    await client.query(`DELETE FROM ${tbl('variant_frequency')} WHERE case_count <= 0`)
  }
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

/** Phase 2: move the annotations of every planned case not moved yet. */
async function moveAnnotations(client: QueryClient, schema: string): Promise<boolean> {
  const tbl = tblOf(schema)
  const unplanned = await client.query(
    `SELECT 1 FROM ${tbl('contig_naming_pending')} WHERE pairs IS NULL LIMIT 1`
  )
  if (unplanned.rows.length > 0) return false // another process is still planning
  const todo = await client.query<{ case_id: string }>(
    `SELECT case_id FROM ${tbl('contig_naming_pending')}
      WHERE NOT annotations_moved ORDER BY case_id FOR UPDATE SKIP LOCKED`
  )
  if (todo.rows.length === 0) return false
  // Every queued case whose variants still carry old names, moved or not.
  const planned = await client.query<{ case_id: string; pairs: ContigRename[] }>(
    `SELECT case_id, pairs FROM ${tbl('contig_naming_pending')} WHERE pairs IS NOT NULL`
  )
  const renames = new Map(planned.rows.map((r) => [Number(r.case_id), r.pairs]))
  await remapGlobalAnnotationsPg(client, schema, renames)
  await client.query(
    `UPDATE ${tbl('contig_naming_pending')} SET annotations_moved = true WHERE case_id = ANY($1::bigint[])`,
    [todo.rows.map((r) => r.case_id)]
  )
  return true
}

/** Phase 3: rename one case whose annotations were moved. */
async function renameOneCase(client: QueryClient, schema: string): Promise<boolean> {
  const tbl = tblOf(schema)
  const next = await client.query<{ case_id: string; pairs: ContigRename[] }>(
    `SELECT case_id, pairs FROM ${tbl('contig_naming_pending')}
      WHERE annotations_moved ORDER BY case_id LIMIT 1 FOR UPDATE SKIP LOCKED`
  )
  const row = next.rows[0]
  if (row === undefined) return false
  const caseId = Number(row.case_id)
  await renameCaseVariantsPg(client, schema, caseId, row.pairs)
  await client.query(`DELETE FROM ${tbl('contig_naming_pending')} WHERE case_id = $1`, [caseId])
  await requestRebuildWhenDone(client, schema)
  return true
}

/** Run one step (one short transaction). Returns false when nothing is left to do here. */
export async function runContigNamingStep({ pool, schema }: ScopedPool): Promise<boolean> {
  const client = (await pool.connect()) as PoolClient
  try {
    await client.query('BEGIN')
    const worked =
      (await planOneCase(client, schema)) ||
      (await moveAnnotations(client, schema)) ||
      (await renameOneCase(client, schema))
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

/** Test-only: await the in-flight job of a schema. */
export async function awaitContigNaming(schema: string): Promise<void> {
  await running.get(schema)
}
