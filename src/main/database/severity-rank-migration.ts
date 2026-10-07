/**
 * SQLite schema v41: stored severity ranks (#469, mirrors PostgreSQL 0025).
 *
 * `variants.impact_rank` / `variants.clinvar_rank` rank the row's impact level
 * (`consequence`) and ClinVar significance (`clinvar`) by the shared severity
 * configuration; the import pipeline writes them from now on. The cohort
 * summary stores the ranks of its representative row and picks that row by
 * them (src/shared/sql/cohort-representative.ts).
 *
 * Existing rows are backfilled here. Impact is a CASE generated from the
 * configuration. A ClinVar string can be multi-valued, which SQL cannot
 * categorise, so the distinct stored strings are ranked with the
 * configuration's normaliser and applied as a lookup table: the stored ranks
 * are what an import would have written. Only rows whose rank differs are
 * touched, so running it again changes nothing.
 *
 * A populated summary is flagged stale: its rows still hold the old
 * per-column maxima and the next cohort read rebuilds them.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import { clinvarRank, impactRankCaseSql } from '../../shared/config/severity.config'
import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'

const RANK_COLUMNS = ['impact_rank', 'clinvar_rank'] as const

/** The variants UPDATE trigger re-indexes the row for full-text search. */
const FTS_UPDATE_TRIGGER = 'variants_fts_au'

function hasTable(db: Database.Database, table: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  )
}

function columnsOf(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info('${table}')`).all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
}

function addRankColumns(db: Database.Database, table: string): void {
  const existing = columnsOf(db, table)
  for (const column of RANK_COLUMNS) {
    if (existing.has(column)) continue
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`)
  }
}

/** Fill the lookup table with the rank of every distinct stored ClinVar string. */
function stageClinvarRanks(db: Database.Database): void {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS severity_clinvar_ranks (
      raw TEXT PRIMARY KEY, rank INTEGER NOT NULL
    ) WITHOUT ROWID;
    DELETE FROM temp.severity_clinvar_ranks;
  `)
  const insert = db.prepare('INSERT INTO temp.severity_clinvar_ranks (raw, rank) VALUES (?, ?)')
  const distinct = db
    .prepare('SELECT DISTINCT clinvar FROM variants WHERE clinvar IS NOT NULL')
    .all() as Array<{ clinvar: unknown }>
  for (const { clinvar } of distinct) {
    if (typeof clinvar !== 'string') continue
    const rank = clinvarRank(clinvar)
    if (rank > 0) insert.run(clinvar, rank)
  }
}

/**
 * Compute both ranks for every variant row that does not carry them yet. A
 * legacy `variants` table without the source column keeps rank 0 for it.
 */
export function backfillVariantSeverityRanks(db: Database.Database): void {
  const columns = columnsOf(db, 'variants')
  const assignments: Array<{ column: string; value: string }> = []
  if (columns.has('consequence')) {
    assignments.push({ column: 'impact_rank', value: impactRankCaseSql('consequence') })
  }
  if (columns.has('clinvar')) {
    stageClinvarRanks(db)
    assignments.push({
      column: 'clinvar_rank',
      value: `COALESCE(
      (SELECT m.rank FROM temp.severity_clinvar_ranks m WHERE m.raw = variants.clinvar), 0)`
    })
  }
  if (assignments.length === 0) return

  // The ranks are not part of the search index: without its trigger the
  // update does not delete and re-insert every row's full-text entry.
  const trigger = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(FTS_UPDATE_TRIGGER) as { sql: string } | undefined
  if (trigger !== undefined) db.exec(`DROP TRIGGER ${FTS_UPDATE_TRIGGER}`)

  db.exec(`
    UPDATE variants
       SET ${assignments.map(({ column, value }) => `${column} = ${value}`).join(',\n           ')}
     WHERE ${assignments.map(({ column, value }) => `${column} <> ${value}`).join('\n        OR ')};
    DROP TABLE IF EXISTS temp.severity_clinvar_ranks;
  `)

  if (trigger !== undefined) db.exec(trigger.sql)
}

export function migrateSeverityRanks(db: Database.Database): void {
  if (hasTable(db, 'variants')) {
    addRankColumns(db, 'variants')
    backfillVariantSeverityRanks(db)
  }
  if (!hasTable(db, 'cohort_variant_summary')) return
  addRankColumns(db, 'cohort_variant_summary')
  const populated = db.prepare('SELECT 1 FROM cohort_variant_summary LIMIT 1').get() !== undefined
  if (populated && hasTable(db, 'cohort_summary_meta')) db.exec(MARK_STALE_SQL)
}
