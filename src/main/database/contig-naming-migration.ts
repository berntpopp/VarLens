/**
 * SQLite schema v47: chromosome names in each build's reference form
 * (spec: .planning/specs/2026-10-12-chr-naming-per-build.md; PG twin:
 * storage/postgres/postgres-contig-naming.ts).
 *
 * Every case whose names are not in its build's form is re-checked first
 * (planCaseContigNaming): confirmed cases are renamed, the others get a
 * `contig_build_review` row and keep their names until the user confirms a
 * build (cases:resolveBuildReviews, contig-rename-sqlite.ts). The database is
 * backed up before the run's first migration (backupBeforeMigrations, called by
 * runMigrations). A second run finds nothing to rename, so it is a no-op.
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
import { mainLogger } from '../services/MainLogger'
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

/**
 * Whether any case stores a name its build would rename: the first test of the
 * v47 plan (contigRenamePairs), over the distinct (build, name) pairs only. A
 * case that ends up flagged instead is counted too, so this errs towards space.
 */
function hasNamesToRename(db: Db): boolean {
  if (!hasTable(db, 'variants')) return false
  const pairs = db
    .prepare(
      `SELECT DISTINCT COALESCE(c.genome_build, '') AS build, v.chr
         FROM variants v JOIN cases c ON c.id = v.case_id`
    )
    .all() as Array<{ build: string; chr: string }>
  return pairs.some((p) => contigRenamePairs([p.chr], p.build).length > 0)
}

const gigabytes = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`

type FreeSpace = (dir: string) => number

const statfsFree: FreeSpace = (dir) => {
  const fs = statfsSync(dir)
  return fs.bavail * fs.bsize
}

/**
 * Disk space the backup (and, when rows will be renamed, the rename's WAL)
 * needs next to the database, as `ratio` x its size.
 */
export function assertFreeSpaceForMigration(
  dbPath: string,
  free: FreeSpace = statfsFree,
  ratio: number = DATABASE_CONFIG.CONTIG_MIGRATION_FREE_SPACE_RATIO
): void {
  const needed = statSync(dbPath).size * ratio
  let available: number
  try {
    available = free(dirname(dbPath))
  } catch (error) {
    // Some filesystems (network shares) report no free space: go on; a full
    // disk still aborts the copy or the transaction before anything changes.
    mainLogger.warn(
      `Free-space check skipped before the pre-migration backup: ${error instanceof Error ? error.message : String(error)}`,
      'database'
    )
    return
  }
  if (available < needed) {
    throw new AppError(
      ErrorCode.RESOURCE_LIMIT,
      `pre-migration backup needs ${needed} bytes free, ${available} available`,
      BUILD_COPY.migrationNoSpace(gigabytes(needed), gigabytes(available))
    )
  }
}

/** The first schema version of this release whose migration rewrites stored data. */
export const DATA_REWRITE_VERSION = 47

/**
 * Before the first pending migration of a run, when the data-rewriting v47 is
 * among them: byte-copy the database to `<db>.pre-v<N>.bak`, N being the first
 * pending version, so the copy is the file the previous release wrote and can
 * open. The rollback of this release's migrations. Not for an in-memory or
 * empty database: there is nothing to keep.
 */
export function backupBeforeMigrations(
  db: Db,
  fromVersion: number,
  free: FreeSpace = statfsFree
): void {
  if (fromVersion >= DATA_REWRITE_VERSION || db.memory || db.name === '') return
  if (!hasTable(db, 'cases') || db.prepare('SELECT 1 FROM cases LIMIT 1').get() === undefined)
    return
  // Room for the rename's WAL only when v47 will rewrite rows (same rule as its plan).
  const ratio = hasNamesToRename(db)
    ? DATABASE_CONFIG.CONTIG_MIGRATION_FREE_SPACE_RATIO
    : DATABASE_CONFIG.BACKUP_ONLY_FREE_SPACE_RATIO
  assertFreeSpaceForMigration(db.name, free, ratio)
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
      `pre-migration backup: WAL checkpoint incomplete (${JSON.stringify(checkpoint)})`,
      BUILD_COPY.migrationBusy
    )
  }
  copyFileSync(db.name, `${db.name}.pre-v${fromVersion + 1}.bak`)
}

export function migrateContigNaming(db: Db): void {
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
