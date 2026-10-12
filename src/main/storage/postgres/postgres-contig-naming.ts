/**
 * PostgreSQL chromosome names per build (spec:
 * .planning/specs/2026-10-12-chr-naming-per-build.md; SQLite twin:
 * database/contig-naming-migration.ts).
 *
 * Migration 0029 queues every existing case in `contig_naming_pending`. This
 * background job takes one case per transaction (FOR UPDATE SKIP LOCKED, so
 * two servers never take the same case), re-checks its build, renames or
 * flags it and dequeues it: a crash resumes at the next case, and a reader
 * sees a case before or after its rewrite, never half of it. Like the
 * severity backfill it is single-flight per schema and backs off on failure.
 * A renamed case asks the cohort summary for a rebuild.
 */
import type { Pool, PoolClient } from 'pg'

import { serializeAuditContractValue } from '../../../shared/audit/audit-contract'
import {
  contigRenamePairs,
  mergeGlobalAnnotations,
  planCaseContigNaming,
  type ContigRename,
  type GlobalAnnotationFields
} from '../../../shared/genome/contig-naming-plan'
import { readVcfHeaderLinesSync } from '../../import/vcf/read-vcf-header-sync'
import { mainLogger } from '../../services/MainLogger'
import { rebuildVariantFrequencyForCase } from './PostgresJsonImportRepository'

type QueryClient = Pick<PoolClient, 'query'>
interface ScopedPool {
  pool: Pick<Pool, 'connect'>
  schema: string
}

const MIGRATION_USER = 'VarLens chromosome-name migration'
const tblOf = (schema: string) => (table: string) => `"${schema}"."${table}"`

type AnnotationRow = GlobalAnnotationFields & { id: string; pos: string; ref: string; alt: string }

async function moveGlobalAnnotations(
  client: QueryClient,
  schema: string,
  caseId: number,
  { from, to }: ContigRename,
  renaming: readonly number[],
  now: number
): Promise<void> {
  const tbl = tblOf(schema)
  const sources = await client.query<AnnotationRow>(
    `SELECT a.* FROM ${tbl('variant_annotations')} a WHERE a.chr = $1 AND EXISTS (
       SELECT 1 FROM ${tbl('variants_all')} v WHERE v.case_id = $2 AND v.chr = a.chr
          AND v.pos = a.pos AND v.ref = a.ref AND v.alt = a.alt)`,
    [from, caseId]
  )
  for (const source of sources.rows) {
    const key = [source.pos, source.ref, source.alt]
    // Another case still uses the old key: the row applied to both loci.
    const used = await client.query(
      `SELECT 1 FROM ${tbl('variants_all')} WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4
          AND case_id <> ALL($5::bigint[]) LIMIT 1`,
      [from, ...key, renaming]
    )
    const keep = used.rows.length > 0
    const target = (
      await client.query<AnnotationRow>(
        `SELECT * FROM ${tbl('variant_annotations')} WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4`,
        [to, ...key]
      )
    ).rows[0]
    if (target === undefined) {
      await client.query(
        keep
          ? `INSERT INTO ${tbl('variant_annotations')} (chr, pos, ref, alt, global_comment, starred,
               acmg_classification, acmg_evidence, created_at, updated_at)
             SELECT $1, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence,
                    created_at, updated_at FROM ${tbl('variant_annotations')} WHERE id = $2`
          : `UPDATE ${tbl('variant_annotations')} SET chr = $1 WHERE id = $2`,
        [to, source.id]
      )
      continue
    }
    const merged = mergeGlobalAnnotations(
      { ...target, updated_at: Number(target.updated_at), starred: Number(target.starred) },
      { ...source, updated_at: Number(source.updated_at), starred: Number(source.starred) }
    )
    await client.query(
      `UPDATE ${tbl('variant_annotations')} SET global_comment = $1, starred = $2,
         acmg_classification = $3, acmg_evidence = $4, updated_at = $5 WHERE id = $6`,
      [
        merged.global_comment,
        merged.starred,
        merged.acmg_classification,
        merged.acmg_evidence,
        now,
        target.id
      ]
    )
    if (merged.discardedAcmg !== null) {
      await client.query(
        `INSERT INTO varlens_audit."audit_log"
           (project_schema, action_type, entity_type, entity_key, old_value, new_value, user_name)
         VALUES ($1, 'acmg_classify', 'variant_annotation', $2, $3, $4, $5)`,
        [
          schema,
          `${to}:${key.join(':')}`,
          serializeAuditContractValue(
            JSON.stringify({ acmg_classification: merged.discardedAcmg })
          ),
          serializeAuditContractValue(
            JSON.stringify({
              acmg_classification: merged.acmg_classification,
              reason: `contig_merge from ${from}:${key.join(':')}`
            })
          ),
          MIGRATION_USER
        ]
      )
    }
    if (!keep) {
      await client.query(`DELETE FROM ${tbl('variant_annotations')} WHERE id = $1`, [source.id])
    }
  }
}

/**
 * Rename one case's contigs with its global annotations and frequencies, in
 * the caller's transaction, and ask the cohort summary for a rebuild.
 */
export async function renameCaseContigsPg(
  client: QueryClient,
  schema: string,
  caseId: number,
  pairs: readonly ContigRename[]
): Promise<void> {
  if (pairs.length === 0) return
  const tbl = tblOf(schema)
  const now = Date.now()
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
    await moveGlobalAnnotations(client, schema, caseId, pair, [caseId], now)
    await client.query(
      `UPDATE ${tbl('variants_all')} SET chr = $1 WHERE case_id = $2 AND chr = $3`,
      [pair.to, caseId, pair.from]
    )
  }
  if (visible) {
    await rebuildVariantFrequencyForCase(client, schema, caseId)
    await client.query(`DELETE FROM ${tbl('variant_frequency')} WHERE case_count <= 0`)
    await client.query(
      `INSERT INTO ${tbl('cohort_summary_rebuild_requests')} (reason) VALUES ('contig_naming')`
    )
  }
}

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

/** Process one queued case. Returns false when the queue is empty (or all taken). */
export async function runContigNamingStep({ pool, schema }: ScopedPool): Promise<boolean> {
  const tbl = tblOf(schema)
  const client = (await pool.connect()) as PoolClient
  try {
    await client.query('BEGIN')
    const next = await client.query<{
      case_id: string
      genome_build: string | null
      file_path: string | null
    }>(
      `SELECT p.case_id, c.genome_build, c.file_path
         FROM ${tbl('contig_naming_pending')} p JOIN ${tbl('cases_all')} c ON c.id = p.case_id
        ORDER BY p.case_id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`
    )
    const row = next.rows[0]
    if (row === undefined) {
      await client.query('COMMIT')
      return false
    }
    const caseId = Number(row.case_id)
    const genomeBuild = row.genome_build ?? ''
    const contigs = await caseContigs(client, schema, caseId)
    const already = await client.query(
      `SELECT 1 FROM ${tbl('contig_build_review')} WHERE case_id = $1`,
      [caseId]
    )
    // Only a case with names to change pays for reading its source file.
    const needsCheck =
      already.rows.length === 0 &&
      contigRenamePairs(
        contigs.map((c) => c.chr),
        genomeBuild
      ).length > 0
    const plan = needsCheck
      ? planCaseContigNaming({
          genomeBuild,
          contigs,
          headerLines: readVcfHeaderLinesSync(row.file_path)
        })
      : ({ action: 'none' } as const)
    if (plan.action === 'rename') await renameCaseContigsPg(client, schema, caseId, plan.pairs)
    if (plan.action === 'flag') {
      await client.query(
        `INSERT INTO ${tbl('contig_build_review')} (case_id, stored_build, suggested_build, reason, created_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (case_id) DO NOTHING`,
        [caseId, genomeBuild, plan.suggestedBuild, plan.reason, Date.now()]
      )
    }
    await client.query(`DELETE FROM ${tbl('contig_naming_pending')} WHERE case_id = $1`, [caseId])
    await client.query('COMMIT')
    return true
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
  let processed = 0
  while (await runContigNamingStep(scope)) processed++
  completed.add(scope.schema)
  if (processed > 0) {
    mainLogger.info(`Chromosome-name check of ${scope.schema}: ${processed} case(s) done`, 'cohort')
  }
}

/**
 * Start the job for a schema unless it runs, is complete or backs off after
 * a failure. Cheap to call on every cohort read.
 */
export function scheduleContigNaming(scope: ScopedPool): void {
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
        `Chromosome-name check of ${scope.schema} failed (attempt ${count}): ${error instanceof Error ? error.message : String(error)}; next attempt in ${Math.round(wait / 60000)} min.`,
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
