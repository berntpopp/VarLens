/**
 * SQLite schema v46: chromosome names in each build's reference form
 * (spec: .planning/specs/2026-10-12-chr-naming-per-build.md; PG twin:
 * storage/postgres/contig-naming-job.ts).
 *
 * Every case whose names are not in its build's form is re-checked first
 * (planCaseContigNaming): confirmed cases are renamed, the others get a
 * `contig_build_review` row and keep their names until the user confirms a
 * build (renameCaseContigs via cases:resolveBuildReview). Before the first
 * rename the database file is copied to `<db>.pre-v46.bak`. A second run finds
 * nothing to rename, so it is a no-op.
 */
import { copyFileSync } from 'node:fs'
import type Database from 'better-sqlite3-multiple-ciphers'

import {
  contigRenamePairs,
  mergeGlobalAnnotations,
  planCaseContigNaming,
  type ContigRename,
  type GlobalAnnotationFields
} from '../../shared/genome/contig-naming-plan'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { readVcfHeaderLinesSync } from '../import/vcf/read-vcf-header-sync'
import { VariantFrequencyService } from './VariantFrequencyService'

type Db = Database.Database

export const CONTIG_BUILD_REVIEW_DDL = `
  CREATE TABLE IF NOT EXISTS contig_build_review (
    case_id INTEGER PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
    stored_build TEXT NOT NULL,
    suggested_build TEXT,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`

const MIGRATION_USER = 'VarLens chromosome-name migration'

const hasTable = (db: Db, table: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
  undefined

/** Header lines of every source file of the case that still exists. */
function caseHeaderLines(db: Db, caseId: number, casePath: string | null): string[] {
  const paths = new Set<string>(casePath === null ? [] : [casePath])
  if (hasTable(db, 'case_import_files')) {
    const rows = db
      .prepare('SELECT file_path FROM case_import_files WHERE case_id = ?')
      .all(caseId) as Array<{ file_path: string }>
    for (const row of rows) paths.add(row.file_path)
  }
  return [...paths].flatMap((path) => readVcfHeaderLinesSync(path))
}

type AnnotationRow = GlobalAnnotationFields & { id: number; pos: number; ref: string; alt: string }

/**
 * Move, copy or merge the global annotations at the renamed keys of the
 * cases in `renaming`. Runs before their variants are renamed.
 */
function moveGlobalAnnotations(
  db: Db,
  caseId: number,
  { from, to }: ContigRename,
  renaming: readonly number[],
  now: number
): void {
  const inRenaming = renaming.map(() => '?').join(', ')
  const sources = db
    .prepare(
      `SELECT a.* FROM variant_annotations a WHERE a.chr = ? AND EXISTS (
         SELECT 1 FROM variants v WHERE v.case_id = ? AND v.chr = a.chr
            AND v.pos = a.pos AND v.ref = a.ref AND v.alt = a.alt)`
    )
    .all(from, caseId) as AnnotationRow[]
  const stillUsed = db.prepare(
    `SELECT 1 FROM variants WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?
        AND case_id NOT IN (${inRenaming}) LIMIT 1`
  )
  const targetOf = db.prepare(
    'SELECT * FROM variant_annotations WHERE chr = ? AND pos = ? AND ref = ? AND alt = ?'
  )
  for (const source of sources) {
    const key = [source.pos, source.ref, source.alt] as const
    // Another build's case still uses the old key: the row applied to both loci.
    const keep = stillUsed.get(from, ...key, ...renaming) !== undefined
    const target = targetOf.get(to, ...key) as AnnotationRow | undefined
    if (target === undefined) {
      if (keep) {
        db.prepare(
          `INSERT INTO variant_annotations (chr, pos, ref, alt, global_comment, starred,
             acmg_classification, acmg_evidence, created_at, updated_at)
           SELECT ?, pos, ref, alt, global_comment, starred, acmg_classification, acmg_evidence,
                  created_at, updated_at FROM variant_annotations WHERE id = ?`
        ).run(to, source.id)
      } else {
        db.prepare('UPDATE variant_annotations SET chr = ? WHERE id = ?').run(to, source.id)
      }
      continue
    }
    const merged = mergeGlobalAnnotations(target, source)
    db.prepare(
      `UPDATE variant_annotations SET global_comment = ?, starred = ?, acmg_classification = ?,
         acmg_evidence = ?, updated_at = ? WHERE id = ?`
    ).run(
      merged.global_comment,
      merged.starred,
      merged.acmg_classification,
      merged.acmg_evidence,
      now,
      target.id
    )
    if (merged.discardedAcmg !== null) {
      db.prepare(
        `INSERT INTO audit_log (timestamp, action_type, entity_type, entity_key, old_value, new_value, user_name)
         VALUES (?, 'acmg_classify', 'variant_annotation', ?, ?, ?, ?)`
      ).run(
        now,
        `${to}:${key.join(':')}`,
        JSON.stringify({ acmg_classification: merged.discardedAcmg }),
        JSON.stringify({
          acmg_classification: merged.acmg_classification,
          reason: `contig_merge from ${from}:${key.join(':')}`
        }),
        MIGRATION_USER
      )
    }
    if (!keep) db.prepare('DELETE FROM variant_annotations WHERE id = ?').run(source.id)
  }
}

/**
 * Rename one case's contigs (`pairs`) with its global annotations and
 * frequencies. `renaming` lists every case renamed in this transaction.
 * The caller marks the cohort summary stale.
 */
export function renameCaseContigs(
  db: Db,
  caseId: number,
  pairs: readonly ContigRename[],
  renaming: readonly number[] = [caseId]
): void {
  if (pairs.length === 0) return
  const now = Date.now()
  const status = db.prepare('SELECT import_status FROM cases WHERE id = ?').get(caseId) as
    { import_status: string | null } | undefined
  const counted = status !== undefined && (status.import_status ?? 'ready') === 'ready'
  const frequencies = new VariantFrequencyService(db)
  if (counted) frequencies.decrementFrequencies(caseId, false)
  for (const pair of pairs) {
    moveGlobalAnnotations(db, caseId, pair, renaming, now)
    db.prepare('UPDATE variants SET chr = ? WHERE case_id = ? AND chr = ?').run(
      pair.to,
      caseId,
      pair.from
    )
  }
  if (counted) {
    frequencies.updateFrequencies(caseId)
    frequencies.pruneZeroCounts()
  }
}

interface CaseContigs {
  genomeBuild: string
  filePath: string | null
  contigs: Array<{ chr: string; maxPos: number }>
}

function storedCaseContigs(db: Db): Map<number, CaseContigs> {
  const rows = db
    .prepare(
      `SELECT c.id, c.genome_build, c.file_path, v.chr, MAX(v.pos) AS max_pos
         FROM variants v JOIN cases c ON c.id = v.case_id
        WHERE c.id NOT IN (SELECT case_id FROM contig_build_review)
        GROUP BY c.id, v.chr`
    )
    .all() as Array<{
    id: number
    genome_build: string | null
    file_path: string | null
    chr: string
    max_pos: number
  }>
  const cases = new Map<number, CaseContigs>()
  for (const row of rows) {
    const entry = cases.get(row.id) ?? {
      genomeBuild: row.genome_build ?? '',
      filePath: row.file_path,
      contigs: []
    }
    entry.contigs.push({ chr: row.chr, maxPos: row.max_pos })
    cases.set(row.id, entry)
  }
  return cases
}

/** Byte copy of the database before its first rename; the rollback of this migration. */
function backupDatabase(db: Db): void {
  if (db.memory || db.name === '') return
  db.pragma('wal_checkpoint(TRUNCATE)')
  copyFileSync(db.name, `${db.name}.pre-v46.bak`)
}

export function migrateContigNaming(db: Db, backup: (db: Db) => void = backupDatabase): void {
  db.exec(CONTIG_BUILD_REVIEW_DDL)
  if (!hasTable(db, 'variants') || !hasTable(db, 'variant_annotations')) return

  const renames: Array<{ caseId: number; pairs: ContigRename[] }> = []
  const flags: Array<{ caseId: number; stored: string; suggested: string | null; reason: string }> =
    []
  for (const [caseId, stored] of storedCaseContigs(db)) {
    // Only a case with names to change pays for reading its source files.
    if (
      contigRenamePairs(
        stored.contigs.map((c) => c.chr),
        stored.genomeBuild
      ).length === 0
    ) {
      continue
    }
    const plan = planCaseContigNaming({
      ...stored,
      headerLines: caseHeaderLines(db, caseId, stored.filePath)
    })
    if (plan.action === 'rename') renames.push({ caseId, pairs: plan.pairs })
    if (plan.action === 'flag') {
      flags.push({
        caseId,
        stored: stored.genomeBuild,
        suggested: plan.suggestedBuild,
        reason: plan.reason
      })
    }
  }
  if (renames.length === 0 && flags.length === 0) return

  if (renames.length > 0) backup(db)
  const renaming = renames.map((r) => r.caseId)
  const now = Date.now()
  db.transaction(() => {
    for (const { caseId, pairs } of renames) renameCaseContigs(db, caseId, pairs, renaming)
    const flag = db.prepare(
      `INSERT OR IGNORE INTO contig_build_review (case_id, stored_build, suggested_build, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const f of flags) flag.run(f.caseId, f.stored, f.suggested, f.reason, now)
    if (renames.length > 0 && hasTable(db, 'cohort_summary_meta')) db.exec(MARK_STALE_SQL)
  })()
}
