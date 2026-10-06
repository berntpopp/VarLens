/**
 * Incremental cohort-summary upkeep for a deleted case (audit 05, D-1).
 *
 * Deleting one case used to rebuild `cohort_variant_summary` and
 * `gene_burden_summary` from every remaining variant (~35 s at 5M rows).
 * This removes only the deleted case's contribution:
 *
 *  1. before the delete, record the case's coordinates and genes in temp tables;
 *  2. after the delete (same transaction), drop the summary rows for exactly
 *     those coordinates/genes and recompute them from the remaining variants
 *     with the same INSERT-SELECT the full rebuild uses, restricted by key;
 *  3. refresh `cohort_frequency` for the case's genome build (its denominator,
 *     the build's case count, just changed).
 *
 * Every column therefore equals what a full rebuild would produce (asserted by
 * `tests/main/database/cohort-summary-case-removal.test.ts`). The helper is
 * only valid when the summary is current beforehand; {@link openCaseSummaryRemoval}
 * returns null for a stale or missing summary and the caller falls back to a
 * full rebuild.
 *
 * Runs inside worker threads: no MainLogger / Electron imports.
 */
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import {
  CHECK_TABLE_EXISTS_SQL,
  geneBurdenInsertSql,
  variantSummaryInsertSql
} from '../../shared/sql/cohort-summary-rebuild'

const CREATE_TEMP_TABLES_SQL = `
  CREATE TEMP TABLE IF NOT EXISTS removed_case_keys (
    chr TEXT NOT NULL, pos INTEGER NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
    PRIMARY KEY (chr, pos, ref, alt)
  ) WITHOUT ROWID;
  CREATE TEMP TABLE IF NOT EXISTS removed_case_genes (
    gene_symbol TEXT PRIMARY KEY
  ) WITHOUT ROWID;
`

const KEY_FILTER = `
      WHERE (v.chr, v.pos, v.ref, v.alt) IN (SELECT chr, pos, ref, alt FROM temp.removed_case_keys)`

const GENE_FILTER = `
    AND v.gene_symbol IN (SELECT gene_symbol FROM temp.removed_case_genes)`

export interface CaseSummaryRemoval {
  /** Capture the case's coordinates/genes. Call inside the delete transaction, before the delete. */
  beforeDelete(caseId: number): void
  /** Recompute the captured keys. Call inside the same transaction, after the delete. */
  afterDelete(): void
}

/** True when `cohort_summary_meta.is_stale` says the summary needs a full rebuild. */
export function isCohortSummaryStale(db: DatabaseType): boolean {
  const row = db.prepare("SELECT value FROM cohort_summary_meta WHERE key = 'is_stale'").get() as
    { value: string } | undefined
  return row?.value === '1'
}

/**
 * Returns an incremental remover, or null when the summary tables are missing
 * (pre-v13 / partial test schema) or already stale (a full rebuild is needed
 * anyway, so patching stale rows would only hide that).
 */
export function openCaseSummaryRemoval(db: DatabaseType): CaseSummaryRemoval | null {
  const exists = db.prepare(CHECK_TABLE_EXISTS_SQL).get() as { c: number }
  if (exists.c === 0 || isCohortSummaryStale(db)) return null

  db.exec(CREATE_TEMP_TABLES_SQL)
  const statements = prepareStatements(db)
  let genomeBuild: string | null = null

  return {
    beforeDelete(caseId) {
      statements.clearKeys.run()
      statements.clearGenes.run()
      statements.captureKeys.run(caseId)
      statements.captureGenes.run(caseId)
      const row = statements.caseBuild.get(caseId) as { genome_build: string | null } | undefined
      genomeBuild = row?.genome_build ?? null
    },
    afterDelete() {
      statements.deleteSummaryRows.run()
      statements.insertSummaryRows.run()
      statements.refreshFrequency.run(genomeBuild)
      statements.deleteGeneRows.run()
      statements.insertGeneRows.run()
    }
  }
}

interface RemovalStatements {
  clearKeys: Statement
  clearGenes: Statement
  captureKeys: Statement
  captureGenes: Statement
  caseBuild: Statement
  deleteSummaryRows: Statement
  insertSummaryRows: Statement
  refreshFrequency: Statement
  deleteGeneRows: Statement
  insertGeneRows: Statement
}

function prepareStatements(db: DatabaseType): RemovalStatements {
  return {
    clearKeys: db.prepare('DELETE FROM temp.removed_case_keys'),
    clearGenes: db.prepare('DELETE FROM temp.removed_case_genes'),
    captureKeys: db.prepare(
      `INSERT OR IGNORE INTO temp.removed_case_keys (chr, pos, ref, alt)
       SELECT chr, pos, ref, alt FROM variants WHERE case_id = ?`
    ),
    captureGenes: db.prepare(
      `INSERT OR IGNORE INTO temp.removed_case_genes (gene_symbol)
       SELECT gene_symbol FROM variants
       WHERE case_id = ? AND gene_symbol IS NOT NULL AND gene_symbol != ''`
    ),
    caseBuild: db.prepare('SELECT genome_build FROM cases WHERE id = ?'),
    deleteSummaryRows: db.prepare(
      `DELETE FROM cohort_variant_summary
       WHERE (chr, pos, ref, alt) IN (SELECT chr, pos, ref, alt FROM temp.removed_case_keys)`
    ),
    insertSummaryRows: db.prepare(variantSummaryInsertSql(KEY_FILTER)),
    // Same expression as the full rebuild's cohort_frequency column.
    refreshFrequency: db.prepare(
      `UPDATE cohort_variant_summary
       SET cohort_frequency = CAST(carrier_count AS REAL) /
         (SELECT COUNT(*) FROM cases WHERE genome_build = cohort_variant_summary.genome_build)
       WHERE genome_build IS ?`
    ),
    deleteGeneRows: db.prepare(
      `DELETE FROM gene_burden_summary
       WHERE gene_symbol IN (SELECT gene_symbol FROM temp.removed_case_genes)`
    ),
    insertGeneRows: db.prepare(geneBurdenInsertSql(GENE_FILTER))
  }
}
