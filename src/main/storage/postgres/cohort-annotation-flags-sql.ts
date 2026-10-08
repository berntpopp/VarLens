/**
 * Sprint A PR-3 C5a — SQL builders and executors for the cohort_variant_summary
 * annotation-flag write-hooks.
 *
 * These are factored out of PostgresAnnotationsRepository so the repository
 * class stays focused on annotation persistence + transaction orchestration,
 * and so the flag-derivation SQL can be reviewed in one place alongside its
 * rebuild() counterpart in PostgresCohortSummaryRepository (Pass-9 #8 — the two
 * must stay in lockstep).
 *
 * The `*Sql(schemaName)` builders take a pre-quoted schema identifier (via
 * quoteIdentifier). The `applyAnnotationFlags*(client, args)` executors run the
 * statement through runNamed inside the caller's transaction (no BEGIN/COMMIT).
 */
import { acmgLabelCaseSql, acmgRankCaseSql } from '../../../shared/config/severity.config'
import type { Pool } from 'pg'

import { InvalidParametersError } from '../../ipc/errors'
import { lockSummaryForWriteWithin } from './cohort-summary-lock'
import {
  ANNOTATION_FLAG_COLUMNS,
  annotationFlagCtes,
  annotationFlagJoins
} from './cohort-summary-flags-sql'
import { quoteIdentifier } from './identifiers'
import { runNamed } from './named-query'

/** runNamed only needs `query`; accept any pool/client that provides it. */
type RunNamedCapable = Pick<Pool, 'query'>

/** ACMG rank of a class expression, from the shared severity configuration. Higher wins. */
const ACMG_RANK_SQL = acmgRankCaseSql

/**
 * SQL `SET` fragment that recomputes the three annotation flag columns of a
 * cohort_variant_summary row (`cvs`) from the live annotation tables. Mirrors
 * the EXISTS / ACMG-rank projection in PostgresCohortSummaryRepository.rebuild
 * (Pass-9 #8) so the write-hooks keep has_star / has_comment / acmg_best in
 * lockstep with a full rebuild.
 *
 * `caseFilter` is an extra predicate (already prefixed with ` AND `) applied to
 * the per-case join on `v` — the on-case-delete variant passes
 * ` AND v.case_id <> $N` so the about-to-be-deleted case is excluded from the
 * EXISTS (Pass-5 HIGH #1); the global / per-case variants pass an empty string.
 */
function flagRecomputeSql(schemaName: string, caseFilter: string): string {
  return `
    has_star = (EXISTS (
      SELECT 1 FROM ${schemaName}."variant_annotations" va
      WHERE va.chr = cvs.chr AND va.pos = cvs.pos
        AND va.ref = cvs.ref AND va.alt = cvs.alt
        AND va.starred = 1
    ) OR EXISTS (
      SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
      JOIN ${schemaName}."variants" v ON cva.variant_id = v.id
      WHERE v.chr = cvs.chr AND v.pos = cvs.pos
        AND v.ref = cvs.ref AND v.alt = cvs.alt
        AND v.variant_type = cvs.variant_type
        AND cva.starred = 1${caseFilter}
    )),
    has_comment = (EXISTS (
      SELECT 1 FROM ${schemaName}."variant_annotations" va
      WHERE va.chr = cvs.chr AND va.pos = cvs.pos
        AND va.ref = cvs.ref AND va.alt = cvs.alt
        AND va.global_comment IS NOT NULL AND va.global_comment <> ''
    ) OR EXISTS (
      SELECT 1 FROM ${schemaName}."case_variant_annotations" cva
      JOIN ${schemaName}."variants" v ON cva.variant_id = v.id
      WHERE v.chr = cvs.chr AND v.pos = cvs.pos
        AND v.ref = cvs.ref AND v.alt = cvs.alt
        AND v.variant_type = cvs.variant_type
        AND cva.per_case_comment IS NOT NULL AND cva.per_case_comment <> ''${caseFilter}
    )),
    acmg_best = (${acmgLabelCaseSql(`(
      SELECT MAX(rank) FROM (
        SELECT ${ACMG_RANK_SQL('va.acmg_classification')} AS rank
        FROM ${schemaName}."variant_annotations" va
        WHERE va.chr = cvs.chr AND va.pos = cvs.pos
          AND va.ref = cvs.ref AND va.alt = cvs.alt
          AND va.acmg_classification IS NOT NULL
        UNION ALL
        SELECT ${ACMG_RANK_SQL('cva.acmg_classification')} AS rank
        FROM ${schemaName}."case_variant_annotations" cva
        JOIN ${schemaName}."variants" v ON cva.variant_id = v.id
        WHERE v.chr = cvs.chr AND v.pos = cvs.pos
          AND v.ref = cvs.ref AND v.alt = cvs.alt
          AND v.variant_type = cvs.variant_type
          AND cva.acmg_classification IS NOT NULL${caseFilter}
      ) ranked
    )`)})`
}

/**
 * Global write-hook: recompute flags on EVERY summary row at (chr, pos, ref,
 * alt). A global annotation has no case scope, so it fans out across every
 * variant_type / genome_build bucket at that coordinate.
 */
export function annotationFlagsGlobalSql(schemaName: string): string {
  return `
    UPDATE ${schemaName}."cohort_variant_summary" cvs
    SET ${flagRecomputeSql(schemaName, '')}
    WHERE cvs.chr = $1 AND cvs.pos = $2 AND cvs.ref = $3 AND cvs.alt = $4
  `
}

/**
 * Per-case write-hook: resolve the target coordinate from (caseId, variantId)
 * via a CTE joining variants on BOTH v.id = $2 AND v.case_id = $1 — a spoofed
 * variantId from another case yields zero target rows (the caller throws
 * InvalidParametersError, Pass-7 LOW #6). Recompute flags on every summary row
 * sharing the resolved coordinate.
 *
 * The statement RETURNS `target_resolved` — the count of variant rows the
 * `target` CTE matched — so the caller can tell "variant does not belong to
 * case" (target_resolved = 0 → throw) apart from "variant resolved but no
 * cohort_variant_summary row to update yet" (target_resolved = 1, zero rows
 * updated → benign no-op when the summary is unbuilt/stale). The summary
 * UPDATE's rowCount is deliberately NOT used as the existence signal because it
 * conflates those two cases.
 */
export function annotationFlagsPerCaseSql(schemaName: string): string {
  return `
    WITH target AS (
      SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type
      FROM ${schemaName}."variants" v
      WHERE v.id = $2 AND v.case_id = $1
    ),
    updated AS (
      UPDATE ${schemaName}."cohort_variant_summary" cvs
      SET ${flagRecomputeSql(schemaName, '')}
      FROM target t
      WHERE cvs.chr = t.chr AND cvs.pos = t.pos
        AND cvs.ref = t.ref AND cvs.alt = t.alt
        AND cvs.variant_type = t.variant_type
      RETURNING 1
    )
    SELECT count(*)::int AS target_resolved FROM target
  `
}

/**
 * On-case-delete write-hook: recompute flags across the whole summary table
 * with the per-case EXISTS subqueries excluding the about-to-be-deleted case
 * (v.case_id <> $1, Pass-5 HIGH #1). Called by C3 step 2 BEFORE the case row
 * (and its cascade-deleted annotations) is removed.
 */
export function annotationFlagsOnCaseDeleteSql(schemaName: string): string {
  // Scoped to coordinates where the deleted case carried a per-case
  // annotation: no other summary row's flags can change, and recomputing the
  // whole table (the previous behaviour) wrote every row of
  // cohort_variant_summary inside the delete transaction (blocking audit W-1).
  return `
    WITH touched AS (
      SELECT DISTINCT v.chr, v.pos, v.ref, v.alt, v.variant_type
      FROM ${schemaName}."case_variant_annotations" cva
      JOIN ${schemaName}."variants_all" v ON v.id = cva.variant_id
      WHERE cva.case_id = $1
    )
    UPDATE ${schemaName}."cohort_variant_summary" cvs
    SET ${flagRecomputeSql(schemaName, ' AND v.case_id <> $1')}
    FROM touched t
    WHERE cvs.chr = t.chr AND cvs.pos = t.pos
      AND cvs.ref = t.ref AND cvs.alt = t.alt
      AND cvs.variant_type = t.variant_type
  `
}

/**
 * How long an annotation save waits for the summary write lock before
 * deferring. Short: a save that defers costs one flags-only refresh, while a
 * save that waits keeps a pool connection for the whole wait.
 */
const SUMMARY_LOCK_WAIT_MS = 300

/**
 * Open an annotation write: BEGIN, then — before any row is locked — try to
 * get the summary write lock for a bounded time. Without it a concurrent
 * rebuild replaces the summary rows from a snapshot older than this write and
 * the flags stay wrong until the next rebuild (#503). When the lock is busy
 * (`summaryLocked: false`) the write-hooks below leave the flags alone and
 * insert an 'annotation' request instead, served by
 * {@link refreshAnnotationFlags}.
 */
export async function beginAnnotationWrite(
  client: RunNamedCapable,
  schema: string,
  waitMs: number = SUMMARY_LOCK_WAIT_MS
): Promise<{ schema: string; summaryLocked: boolean }> {
  await client.query('BEGIN')
  return { schema, summaryLocked: await lockSummaryForWriteWithin(client, schema, waitMs) }
}

/**
 * Serve the 'annotation' requests: set the three flag columns of every
 * summary row that differs from the annotation tables, with the projection
 * the rebuild uses. No count is touched, so this is no rebuild. A no-op
 * without a request. Call under the summary write lock.
 *
 * One statement on purpose: the requests it deletes and the annotations it
 * reads come from one snapshot, and a save inserts its request in the
 * transaction that writes the annotation. A request committed later is not
 * deleted and is served by the next call.
 */
export async function refreshAnnotationFlags(
  client: RunNamedCapable,
  schema: string
): Promise<void> {
  const tbl = (t: string): string => `${quoteIdentifier(schema)}."${t}"`
  await client.query(`
    WITH served AS (
      DELETE FROM ${tbl('cohort_summary_rebuild_requests')}
      WHERE reason = 'annotation' RETURNING 1
    ),
    ${annotationFlagCtes(tbl)},
    fresh AS (
      SELECT a.chr, a.pos, a.ref, a.alt, a.variant_type, a.genome_build,
             ${ANNOTATION_FLAG_COLUMNS}
      FROM ${tbl('cohort_variant_summary')} a
      ${annotationFlagJoins('a')}
      WHERE EXISTS (SELECT 1 FROM served)
    )
    UPDATE ${tbl('cohort_variant_summary')} cvs
    SET has_star = f.has_star, has_comment = f.has_comment, acmg_best = f.acmg_best
    FROM fresh f
    WHERE cvs.chr = f.chr AND cvs.pos = f.pos AND cvs.ref = f.ref AND cvs.alt = f.alt
      AND cvs.variant_type = f.variant_type AND cvs.genome_build = f.genome_build
      AND (cvs.has_star, cvs.has_comment, cvs.acmg_best)
          IS DISTINCT FROM (f.has_star, f.has_comment, f.acmg_best)`)
}

/**
 * Global annotation write-hook (C5a / Pass-4 MED #4). Recomputes the three flag
 * columns on EVERY cohort_variant_summary row matching (chr, pos, ref, alt) — a
 * global annotation has no case scope, so it fans out across every variant_type
 * / genome_build bucket at that coordinate. Runs inside the caller's
 * transaction.
 */
export async function applyAnnotationFlagsGlobal(
  client: RunNamedCapable,
  args: {
    schema: string
    summaryLocked: boolean
    chr: string
    pos: number
    ref: string
    alt: string
  }
): Promise<void> {
  const schemaName = quoteIdentifier(args.schema)
  if (!args.summaryLocked) {
    await client.query(
      `INSERT INTO ${schemaName}."cohort_summary_rebuild_requests" (reason)
       SELECT 'annotation' WHERE EXISTS (
         SELECT 1 FROM ${schemaName}."variants"
         WHERE chr = $1 AND pos = $2 AND ref = $3 AND alt = $4)`,
      [args.chr, args.pos, args.ref, args.alt]
    )
    return
  }
  await runNamed(client as Pool, {
    name: 'cohort_summary:annotation_flags_global:v1',
    text: annotationFlagsGlobalSql(schemaName),
    values: [args.chr, args.pos, args.ref, args.alt],
    schema: args.schema
  })
}

/**
 * Per-case annotation write-hook (C5a / Pass-7 LOW #6). Resolves the target
 * coordinate from (caseId, variantId) via a CTE joining variants on BOTH
 * v.id = $variantId AND v.case_id = $caseId — a spoofed variantId from another
 * case yields zero target rows and we throw InvalidParametersError rather than
 * silently no-op. Recomputes the flag columns for every summary row sharing the
 * resolved coordinate. Runs inside the caller's transaction.
 *
 * The throw is keyed on `target_resolved` (whether the variant itself belongs
 * to the case), NOT on the number of cohort_variant_summary rows updated. A
 * valid variant whose summary row does not exist yet (summary unbuilt/stale —
 * see C3 import wiring) resolves the target but updates zero rows; that is a
 * benign no-op, not an InvalidParametersError (PR3-7 review MAJOR #3).
 */
export async function applyAnnotationFlagsPerCase(
  client: RunNamedCapable,
  args: { schema: string; summaryLocked: boolean; caseId: number; variantId: number }
): Promise<void> {
  const schemaName = quoteIdentifier(args.schema)
  const result = args.summaryLocked
    ? await runNamed<{ target_resolved: number }>(client as Pool, {
        name: 'cohort_summary:annotation_flags_per_case:v2',
        text: annotationFlagsPerCaseSql(schemaName),
        values: [args.caseId, args.variantId],
        schema: args.schema
      })
    : // Same ownership check as the hook; the flags are left to the rebuild.
      await client.query<{ target_resolved: number }>(
        `WITH target AS (
           SELECT 1 FROM ${schemaName}."variants" v WHERE v.id = $2 AND v.case_id = $1
         ),
         requested AS (
           INSERT INTO ${schemaName}."cohort_summary_rebuild_requests" (reason)
           SELECT 'annotation' FROM target
         )
         SELECT count(*)::int AS target_resolved FROM target`,
        [args.caseId, args.variantId]
      )
  const targetResolved = result.rows[0]?.target_resolved ?? 0
  if (targetResolved === 0) {
    throw new InvalidParametersError(
      `Per-case annotation flag hook matched no variant for case ${args.caseId} / variant ${args.variantId}.`
    )
  }
}

/**
 * On-case-delete annotation write-hook (C5a / Pass-5 HIGH #1). Called by C3
 * step 2 BEFORE the case row (and its cascade-deleted annotations) is removed.
 * Recomputes the flag columns across the whole summary table with the per-case
 * EXISTS subqueries excluding the about-to-be-deleted case (v.case_id <>
 * $deletedCaseId) so flags backed solely by that case clear in the same
 * transaction. Runs inside the caller's transaction.
 */
export async function applyAnnotationFlagsOnCaseDelete(
  client: RunNamedCapable,
  args: { schema: string; deletedCaseId: number }
): Promise<void> {
  const schemaName = quoteIdentifier(args.schema)
  await runNamed(client as Pool, {
    name: 'cohort_summary:annotation_flags_on_case_delete:v2',
    text: annotationFlagsOnCaseDeleteSql(schemaName),
    values: [args.deletedCaseId],
    schema: args.schema
  })
}
