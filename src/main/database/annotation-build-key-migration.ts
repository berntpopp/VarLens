/**
 * SQLite schema v52 (#577; PG twin 0035_annotation_genome_build.sql): global
 * annotations (`variant_annotations`: star, comment, ACMG call) are keyed by
 * genome build as well as chr:pos:ref:alt, so a GRCh37 and a GRCh38 case at
 * the same numbers no longer share one call.
 *
 * Every existing row applied to every build's locus, so it is COPIED, never
 * moved: one row per build of the cases that hold the coordinate, and a row no
 * case uses goes to every build present (to the column default when there are
 * no cases). Nothing is dropped. The flag triggers are recreated build-aware
 * and a populated cohort summary is flagged stale so its flags are recomputed.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import { canonicalGenomeBuildId } from '../../shared/config/genome-builds.config'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { CONTIG_BUILD_REVIEW_DDL, migrateContigNaming } from './contig-naming-migration'
import {
  createAnnotationFlagTriggers,
  dropAnnotationFlagTriggers
} from './annotation-flag-triggers'

type Db = Database.Database

/** cases.genome_build's column default (v19), for cases without a build. */
const CASE_BUILD = "COALESCE(c.genome_build, 'GRCh38')"

const COPY_COLUMNS =
  'global_comment, starred, acmg_classification, acmg_evidence, created_at, updated_at'

const CARRIER_AT_KEY = `FROM variants v JOIN cases c ON c.id = v.case_id
  WHERE v.chr = va.chr AND v.pos = va.pos AND v.ref = va.ref AND v.alt = va.alt`

const hasTable = (db: Db, name: string): boolean =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined

/**
 * Before the split (PG twin in 0035): imports before f51a8e6c stored any
 * build string, but the key needs build ids. Aliases become their id
 * ('hg19', 'GRCh37.p13' → GRCh37); a value that matches no build is kept
 * and its cases get a build review, where the user confirms one.
 */
function normaliseCaseBuilds(db: Db): void {
  const values = db
    .prepare('SELECT DISTINCT genome_build FROM cases WHERE genome_build IS NOT NULL')
    .pluck()
    .all() as string[]
  db.exec(CONTIG_BUILD_REVIEW_DDL)
  const rename = db.prepare('UPDATE cases SET genome_build = ? WHERE genome_build = ?')
  // A v47 review keeps showing what is stored, so it names the id too.
  const renameReviewed = db.prepare(
    'UPDATE contig_build_review SET stored_build = ? WHERE stored_build = ?'
  )
  const unknown: string[] = []
  for (const value of values) {
    const id = canonicalGenomeBuildId(value)
    if (id === null) unknown.push(value)
    else if (id !== value) {
      rename.run(id, value)
      renameReviewed.run(id, value)
    }
  }
  if (unknown.length === 0) return
  db.prepare(
    `INSERT OR IGNORE INTO contig_build_review (case_id, stored_build, suggested_build, reason, created_at)
     SELECT id, genome_build, NULL, 'build_unknown', ? FROM cases
      WHERE genome_build IN (${unknown.map(() => '?').join(', ')})`
  ).run(Date.now(), ...unknown)
}

export function migrateAnnotationBuildKey(db: Db): void {
  if (!hasTable(db, 'variant_annotations')) return
  const columns = db.prepare('PRAGMA table_info(variant_annotations)').all() as Array<{
    name: string
  }>
  if (columns.some((c) => c.name === 'genome_build')) {
    createAnnotationFlagTriggers(db)
    return
  }
  const indexes = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'variant_annotations' AND sql IS NOT NULL"
    )
    .pluck()
    .all() as string[]

  db.transaction(() => {
    dropAnnotationFlagTriggers(db)
    if (hasTable(db, 'cases')) {
      normaliseCaseBuilds(db)
      // A case whose build was only now recognised gets its build's names (the
      // v47 step: a reviewed case is skipped, a confirmed one renamed with its
      // notes), so the split below sees each case under its build's names.
      migrateContigNaming(db)
    }
    db.exec(`
      CREATE TABLE variant_annotations__build (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chr TEXT NOT NULL,
        pos INTEGER NOT NULL,
        ref TEXT NOT NULL,
        alt TEXT NOT NULL,
        genome_build TEXT NOT NULL,
        global_comment TEXT,
        starred INTEGER NOT NULL DEFAULT 0,
        acmg_classification TEXT,
        acmg_evidence TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(chr, pos, ref, alt, genome_build)
      )`)
    const builds = `(SELECT DISTINCT ${CASE_BUILD} AS genome_build FROM cases c
      UNION SELECT 'GRCh38' WHERE NOT EXISTS (SELECT 1 FROM cases)) b`
    const insert = `INSERT INTO variant_annotations__build
      (chr, pos, ref, alt, genome_build, ${COPY_COLUMNS})
      SELECT va.chr, va.pos, va.ref, va.alt, b.genome_build, ${COPY_COLUMNS.split(', ')
        .map((c) => `va.${c}`)
        .join(', ')}
      FROM variant_annotations va CROSS JOIN ${builds}`
    // A copy for each build whose cases hold the coordinate ...
    db.exec(`${insert}
      WHERE EXISTS (SELECT 1 ${CARRIER_AT_KEY} AND ${CASE_BUILD} = b.genome_build)`)
    // ... and a row no case uses for every build.
    db.exec(`${insert} WHERE NOT EXISTS (SELECT 1 ${CARRIER_AT_KEY})`)
    db.exec('DROP TABLE variant_annotations')
    db.exec('ALTER TABLE variant_annotations__build RENAME TO variant_annotations')
    for (const sql of indexes) db.exec(sql)
    createAnnotationFlagTriggers(db)
    if (hasTable(db, 'cohort_summary_meta')) db.exec(MARK_STALE_SQL)
  })()
}
