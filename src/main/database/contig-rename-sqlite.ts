/**
 * SQLite contig renames (spec: .planning/specs/2026-10-12-chr-naming-per-build.md):
 * the global-annotation remap, the per-case variant rename and the user's
 * build confirmations. Used by the v47 migration (contig-naming-migration.ts)
 * and by cases:resolveBuildReviews. PG twin: storage/postgres/postgres-contig-naming.ts.
 *
 * Callers run these inside one transaction.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import { isImportableGenomeBuild } from '../../shared/config/genome-builds.config'
import {
  annotationGroupKey,
  remapAnnotationGroup,
  type AnnotationRow,
  type GroupRemap
} from '../../shared/genome/annotation-remap'
import { contigRenamePairs, type ContigRename } from '../../shared/genome/contig-naming-plan'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import type { BuildReview, BuildReviewChoice } from '../../shared/types/build-review'
import { contigQueryNames } from '../../shared/utils/contig'
import { auditActorName } from '../security/request-context'
import { VariantFrequencyService } from './VariantFrequencyService'

type Db = Database.Database

export const CONTIG_MIGRATION_USER = 'VarLens chromosome-name migration'

export const hasTable = (db: Db, table: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
  undefined

function applyGroupRemap(db: Db, remap: GroupRemap, now: number): void {
  const del = db.prepare('DELETE FROM variant_annotations WHERE id = ?')
  for (const id of remap.deleteIds) del.run(id)
  const ins = db.prepare(
    `INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred,
       acmg_classification, acmg_evidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const r of remap.inserts) {
    ins.run(
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
    )
  }
  const audit = db.prepare(
    `INSERT INTO audit_log (timestamp, action_type, entity_type, entity_key, old_value, new_value, user_name)
     VALUES (?, 'acmg_classify', 'variant_annotation', ?, ?, ?, ?)`
  )
  for (const a of remap.audits) {
    audit.run(
      now,
      a.key,
      JSON.stringify({ acmg_classification: a.discarded }),
      JSON.stringify({ acmg_classification: a.kept, reason: `contig_merge of ${a.from}` }),
      CONTIG_MIGRATION_USER
    )
  }
}

/**
 * Move, copy and merge the global annotations for the renames in `renames`
 * (case id → its pairs), decided per locus group from the final names. Runs
 * before the variants are renamed.
 */
export function remapGlobalAnnotations(
  db: Db,
  renames: ReadonlyMap<number, readonly ContigRename[]>,
  now = Date.now()
): void {
  const froms = new Set([...renames.values()].flatMap((pairs) => pairs.map((p) => p.from)))
  if (froms.size === 0) return
  const newName = (caseId: number, chr: string): string =>
    renames.get(caseId)?.find((p) => p.from === chr)?.to ?? chr
  const rows = db.prepare('SELECT * FROM variant_annotations').all() as AnnotationRow[]
  const groups = new Map<string, AnnotationRow[]>()
  for (const row of rows) {
    const key = annotationGroupKey(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  for (const group of groups.values()) {
    if (!group.some((r) => froms.has(r.chr))) continue
    const names = [...new Set(group.flatMap((r) => [r.chr, ...contigQueryNames(r.chr)]))]
    const { pos, ref, alt } = group[0]
    const usages = db
      .prepare(
        `SELECT DISTINCT case_id AS caseId, chr FROM variants
          WHERE chr IN (${names.map(() => '?').join(', ')}) AND pos = ? AND ref = ? AND alt = ?`
      )
      .all(...names, pos, ref, alt) as Array<{ caseId: number; chr: string }>
    const remap = remapAnnotationGroup(group, usages, newName)
    if (remap !== null) applyGroupRemap(db, remap, now)
  }
}

/**
 * Rename one case's variants and recount its frequencies. Only rows under an
 * old name are written (`WHERE chr = from`): canonical rows are not touched.
 */
export function renameCaseVariants(db: Db, caseId: number, pairs: readonly ContigRename[]): void {
  if (pairs.length === 0) return
  const status = db.prepare('SELECT import_status FROM cases WHERE id = ?').get(caseId) as
    { import_status: string | null } | undefined
  const counted = status !== undefined && (status.import_status ?? 'ready') === 'ready'
  const frequencies = new VariantFrequencyService(db)
  if (counted) frequencies.decrementFrequencies(caseId, false)
  const update = db.prepare('UPDATE variants SET chr = ? WHERE case_id = ? AND chr = ?')
  for (const pair of pairs) update.run(pair.to, caseId, pair.from)
  if (counted) {
    frequencies.updateFrequencies(caseId)
    frequencies.pruneZeroCounts()
  }
}

/** Remap annotations for every rename, then rename each case (caller's transaction). */
export function renameCases(db: Db, renames: ReadonlyMap<number, readonly ContigRename[]>): void {
  remapGlobalAnnotations(db, renames)
  for (const [caseId, pairs] of renames) renameCaseVariants(db, caseId, pairs)
  if (renames.size > 0 && hasTable(db, 'cohort_summary_meta')) db.exec(MARK_STALE_SQL)
}

/** Cases waiting for the user to confirm their build (cases:buildReviews). */
export function listBuildReviews(db: Db): BuildReview[] {
  if (!hasTable(db, 'contig_build_review')) return []
  return db
    .prepare(
      `SELECT r.case_id AS caseId, c.name AS caseName, r.stored_build AS storedBuild,
              r.suggested_build AS suggestedBuild, r.reason
         FROM contig_build_review r JOIN cases c ON c.id = r.case_id
        ORDER BY r.reason, c.name`
    )
    .all() as BuildReview[]
}

/**
 * The user confirmed a build per flagged case: store each (audit-logged),
 * rename the cases to their builds' form and drop the reviews, all in one
 * transaction (cases:resolveBuildReviews).
 */
export function resolveBuildReviews(db: Db, choices: readonly BuildReviewChoice[]): number {
  for (const c of choices) {
    if (!isImportableGenomeBuild(c.build)) throw new Error(`Unknown genome build: ${c.build}`)
  }
  const now = Date.now()
  const user = auditActorName('local')
  db.transaction(() => {
    const renames = new Map<number, ContigRename[]>()
    const audit = db.prepare(
      `INSERT INTO audit_log (timestamp, action_type, entity_type, entity_key, old_value, new_value, user_name)
       VALUES (?, 'api_write', 'api_call', ?, ?, ?, ?)`
    )
    for (const { caseId, build } of choices) {
      const review = db
        .prepare('SELECT stored_build FROM contig_build_review WHERE case_id = ?')
        .get(caseId) as { stored_build: string } | undefined
      if (review === undefined) throw new Error(`Case ${caseId} has no genome build to confirm`)
      const old = db.prepare('SELECT genome_build FROM cases WHERE id = ?').get(caseId) as {
        genome_build: string | null
      }
      db.prepare('UPDATE cases SET genome_build = ? WHERE id = ?').run(build, caseId)
      audit.run(
        now,
        `cases:${caseId}:genome_build`,
        JSON.stringify({ genome_build: old.genome_build }),
        JSON.stringify({ genome_build: build, reason: 'build_review' }),
        user
      )
      const chrs = (
        db.prepare('SELECT DISTINCT chr FROM variants WHERE case_id = ?').all(caseId) as Array<{
          chr: string
        }>
      ).map((r) => r.chr)
      renames.set(caseId, contigRenamePairs(chrs, build))
      db.prepare('DELETE FROM contig_build_review WHERE case_id = ?').run(caseId)
    }
    renameCases(db, renames)
    // The summary is keyed by build: a changed build alone needs a rebuild too.
    if (hasTable(db, 'cohort_summary_meta')) db.exec(MARK_STALE_SQL)
  })()
  return choices.length
}
