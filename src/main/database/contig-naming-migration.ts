/**
 * SQLite schema v46: chromosome names in each build's reference form
 * (spec: .planning/specs/2026-10-12-chr-naming-per-build.md; PG twin:
 * storage/postgres/postgres-contig-naming.ts).
 *
 * Every case whose names are not in its build's form is re-checked first
 * (planCaseContigNaming): confirmed cases are renamed, the others get a
 * `contig_build_review` row and keep their names until the user confirms a
 * build (cases:resolveBuildReviews, contig-rename-sqlite.ts). Before the first
 * rename the free space is checked and the database file is copied to
 * `<db>.pre-v46.bak`. A second run finds nothing to rename, so it is a no-op.
 */
import { copyFileSync, statSync, statfsSync } from 'node:fs'
import { dirname } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'

import { DATABASE_CONFIG } from '../../shared/config/database.config'
import { BUILD_COPY } from '../../shared/config/genome-builds.config'
import {
  contigRenamePairs,
  planCaseContigNaming,
  type ContigRename
} from '../../shared/genome/contig-naming-plan'
import { ErrorCode } from '../../shared/types/errors'
import { readVcfHeaderLinesSync } from '../import/vcf/read-vcf-header'
import { AppError } from '../ipc/errors'
import { hasTable, renameCases } from './contig-rename-sqlite'

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

const gigabytes = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

/** Disk space the backup and the rename's WAL need next to the database. */
export function assertFreeSpaceForMigration(
  dbPath: string,
  free: (dir: string) => number = (dir) => {
    const fs = statfsSync(dir)
    return fs.bavail * fs.bsize
  }
): void {
  const needed = statSync(dbPath).size * DATABASE_CONFIG.CONTIG_MIGRATION_FREE_SPACE_RATIO
  const available = free(dirname(dbPath))
  if (available < needed) {
    throw new AppError(
      ErrorCode.RESOURCE_LIMIT,
      `v46 migration needs ${needed} bytes free, ${available} available`,
      BUILD_COPY.migrationNoSpace(gigabytes(needed), gigabytes(available))
    )
  }
}

/** Byte copy of the database before its first rename; the rollback of this migration. */
function backupDatabase(db: Db): void {
  if (db.memory || db.name === '') return
  assertFreeSpaceForMigration(db.name)
  // The copy is only complete when every WAL frame is back in the main file.
  const [checkpoint] = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
    busy: number
    log: number
    checkpointed: number
  }>
  if (
    checkpoint !== undefined &&
    (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed)
  ) {
    throw new AppError(
      ErrorCode.CONFLICT,
      `v46 backup: WAL checkpoint incomplete (${JSON.stringify(checkpoint)})`,
      BUILD_COPY.migrationBusy
    )
  }
  copyFileSync(db.name, `${db.name}.pre-v46.bak`)
}

export function migrateContigNaming(db: Db, backup: (db: Db) => void = backupDatabase): void {
  db.exec(CONTIG_BUILD_REVIEW_DDL)
  if (!hasTable(db, 'variants') || !hasTable(db, 'variant_annotations')) return

  const renames = new Map<number, ContigRename[]>()
  const flags: Array<{ caseId: number; stored: string; suggested: string | null; reason: string }> =
    []
  for (const [caseId, stored] of storedCaseContigs(db)) {
    // A case already in its build's form is skipped: no file read, no row written.
    const chrs = stored.contigs.map((c) => c.chr)
    if (contigRenamePairs(chrs, stored.genomeBuild).length === 0) continue
    const plan = planCaseContigNaming({
      ...stored,
      headerLines: caseHeaderLines(db, caseId, stored.filePath)
    })
    if (plan.action === 'rename') renames.set(caseId, plan.pairs)
    if (plan.action === 'flag') {
      flags.push({
        caseId,
        stored: stored.genomeBuild,
        suggested: plan.suggestedBuild,
        reason: plan.reason
      })
    }
  }
  if (renames.size === 0 && flags.length === 0) return

  if (renames.size > 0) backup(db)
  const now = Date.now()
  db.transaction(() => {
    renameCases(db, renames)
    const flag = db.prepare(
      `INSERT OR IGNORE INTO contig_build_review (case_id, stored_build, suggested_build, reason, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    for (const f of flags) flag.run(f.caseId, f.stored, f.suggested, f.reason, now)
  })()
}
