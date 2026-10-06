/**
 * SQLite expression indexes for natural chromosome order (migration v33).
 *
 * Every index is built on `chrRankSql('chr')`, the exact expression the sort
 * sinks emit (VariantFilterBuilder.applySort, CohortService), so SQLite's
 * planner can walk the index instead of sorting the whole filtered set.
 * PostgreSQL mirrors these names in `0017_chr_rank_indexes.sql`.
 *
 * - idx_variants_case_chr_rank: case view default order
 *   `WHERE case_id = ? ORDER BY rank, chr, pos, id` (rowid = id is implicit).
 * - idx_cvs_chr_rank: cohort view sorted by chromosome.
 * - idx_cvs_carrier_chr_rank: cohort default `carrier_count DESC` + genomic tiebreaker.
 */
import type Database from 'better-sqlite3-multiple-ciphers'
import { chrRankSql } from '../../shared/sql/chromosome-order'

export const CHR_RANK_VARIANTS_INDEX = 'idx_variants_case_chr_rank'
export const CHR_RANK_CVS_INDEX = 'idx_cvs_chr_rank'
export const CHR_RANK_CVS_CARRIER_INDEX = 'idx_cvs_carrier_chr_rank'

/** Also re-created by the import pipeline after bulk inserts (RECREATE_INDEXES). */
export const CREATE_CHR_RANK_VARIANTS_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${CHR_RANK_VARIANTS_INDEX} ON variants(case_id, ${chrRankSql('chr')}, chr, pos)`

const CREATE_CHR_RANK_CVS_INDEXES_SQL = [
  `CREATE INDEX IF NOT EXISTS ${CHR_RANK_CVS_INDEX} ON cohort_variant_summary(${chrRankSql('chr')}, chr, pos, ref, alt)`,
  `CREATE INDEX IF NOT EXISTS ${CHR_RANK_CVS_CARRIER_INDEX} ON cohort_variant_summary(carrier_count DESC, ${chrRankSql('chr')}, chr, pos, ref, alt)`
]

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !==
    undefined
  )
}

/**
 * Migration v33 body. Idempotent (IF NOT EXISTS); caller bumps user_version.
 * Skips tables that a partial (test) schema does not have.
 */
export function createChrRankIndexes(db: Database.Database): void {
  if (tableExists(db, 'variants')) db.exec(CREATE_CHR_RANK_VARIANTS_INDEX_SQL)
  if (tableExists(db, 'cohort_variant_summary')) {
    for (const statement of CREATE_CHR_RANK_CVS_INDEXES_SQL) db.exec(statement)
  }
}
