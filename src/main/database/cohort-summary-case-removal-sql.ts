/**
 * SQL for the incremental case removal in cohort-summary-case-removal.ts.
 *
 * Temp tables (per connection, cleared per case):
 *   removed_case_rows        — the case's best row and genotype per summary key
 *   removed_case_recompute   — coordinates whose representative must be recomputed
 *   removed_case_gene_rows   — the case's row count per gene
 *   removed_case_gene_coords — the case's distinct coordinates per gene
 *   removed_case_gene_lost   — per gene, coordinates no remaining variant keeps
 */
import type { Database as DatabaseType, Statement } from 'better-sqlite3-multiple-ciphers'
import {
  REPRESENTATIVE_COLUMNS,
  remainingRowCovers,
  removalAffectsSummary,
  representativeColumnList,
  summaryColumnsOverWindow,
  transcriptOrderBy
} from '../../shared/sql/cohort-representative'
import { perCaseAnnotationFlagsSql } from '../../shared/sql/cohort-summary-rebuild'
import {
  HET_GT_SQL as HET,
  HOM_GT_SQL as HOM,
  resolvedGtSql
} from '../../shared/sql/genotype-dosage'

export const CASE_REMOVAL_TEMP_TABLES_SQL = `
  CREATE TEMP TABLE IF NOT EXISTS removed_case_rows (
    chr TEXT, pos INTEGER, ref TEXT, alt TEXT, variant_type TEXT, genome_build TEXT,
    ${REPRESENTATIVE_COLUMNS.join(', ')}, het INTEGER, hom INTEGER
  );
  CREATE TEMP TABLE IF NOT EXISTS removed_case_recompute (
    chr TEXT NOT NULL, pos INTEGER NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
    PRIMARY KEY (chr, pos, ref, alt)
  ) WITHOUT ROWID;
  CREATE TEMP TABLE IF NOT EXISTS removed_case_gene_rows (
    gene_symbol TEXT PRIMARY KEY, row_count INTEGER NOT NULL
  ) WITHOUT ROWID;
  CREATE TEMP TABLE IF NOT EXISTS removed_case_gene_coords (
    gene_symbol TEXT NOT NULL, chr TEXT NOT NULL, pos INTEGER NOT NULL,
    ref TEXT NOT NULL, alt TEXT NOT NULL,
    PRIMARY KEY (gene_symbol, chr, pos, ref, alt)
  ) WITHOUT ROWID;
  CREATE TEMP TABLE IF NOT EXISTS removed_case_gene_lost (
    gene_symbol TEXT PRIMARY KEY, lost INTEGER NOT NULL
  ) WITHOUT ROWID;
`

export const CLEAR_TEMP_TABLES_SQL = `
  DELETE FROM temp.removed_case_rows;
  DELETE FROM temp.removed_case_recompute;
  DELETE FROM temp.removed_case_gene_rows;
  DELETE FROM temp.removed_case_gene_coords;
  DELETE FROM temp.removed_case_gene_lost;
`

/** The case's per-key contribution: its best row and genotype, as the rebuild's first stage. */
const CAPTURE_ROWS_SQL = `
  INSERT INTO temp.removed_case_rows
  SELECT d.chr, d.pos, d.ref, d.alt, d.variant_type, d.genome_build,
    ${representativeColumnList('d')},
    CASE WHEN d.gt_num IN ${HET} THEN 1 ELSE 0 END,
    CASE WHEN d.gt_num IN ${HOM} THEN 1 ELSE 0 END
  FROM (
    SELECT v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build,
      ${summaryColumnsOverWindow('v', 'case_key', 'sqlite')},
      ${resolvedGtSql('v.gt_num', 'sqlite', ' OVER case_key')} AS gt_num,
      ROW_NUMBER() OVER (case_key ORDER BY ${transcriptOrderBy('v', 'sqlite')}) AS rn
    FROM variants v
    JOIN cases c ON c.id = v.case_id
    WHERE v.case_id = ?
    WINDOW case_key AS (PARTITION BY v.chr, v.pos, v.ref, v.alt, v.variant_type, c.genome_build)
  ) d
  WHERE d.rn = 1`

const SUMMARY_KEY_JOIN = `s.chr = k.chr AND s.pos = k.pos AND s.ref = k.ref AND s.alt = k.alt
    AND s.variant_type = k.variant_type AND s.genome_build IS k.genome_build`

/**
 * Coordinates whose annotation may change: the case supplies the transcript
 * or holds a variant-level fact, and no single remaining carrier row of the
 * same key supplies all of that. Keys losing their last carrier are simply
 * dropped (no recompute).
 */
const MARK_RECOMPUTE_SQL = `
  INSERT OR IGNORE INTO temp.removed_case_recompute (chr, pos, ref, alt)
  SELECT k.chr, k.pos, k.ref, k.alt
  FROM temp.removed_case_rows k
  JOIN cohort_variant_summary s ON ${SUMMARY_KEY_JOIN}
  WHERE s.carrier_count > 1
    AND (${removalAffectsSummary('k', 's', 'sqlite')})
    AND NOT EXISTS (
      SELECT 1 FROM variants r JOIN cases rc ON rc.id = r.case_id AND rc.import_status = 'ready'
      WHERE r.chr = k.chr AND r.pos = k.pos AND r.ref = k.ref AND r.alt = k.alt
        AND r.variant_type = k.variant_type AND rc.genome_build IS k.genome_build
        AND ${remainingRowCovers('r', 'k', 's', 'sqlite')}
    )`

const RECOMPUTE_FILTER = `
      WHERE (v.chr, v.pos, v.ref, v.alt) IN
        (SELECT chr, pos, ref, alt FROM temp.removed_case_recompute)`

export interface RemovalStatements {
  caseBuild: Statement
  captureRows: Statement
  captureGeneRows: Statement
  captureGeneCoords: Statement
  markRecompute: Statement
  deleteRecomputeRows: Statement
  decrementRows: Statement
  dropEmptyRows: Statement
  insertRecomputeRows: Statement
  applyRecomputedPerCaseFlags: Statement
  countLostGeneCoords: Statement
  decrementGenes: Statement
  dropEmptyGenes: Statement
}

export function prepareRemovalStatements(
  db: DatabaseType,
  variantSummaryInsertSql: (filter: string) => string
): RemovalStatements {
  return {
    caseBuild: db.prepare('SELECT genome_build FROM cases WHERE id = ?'),
    captureRows: db.prepare(CAPTURE_ROWS_SQL),
    captureGeneRows: db.prepare(
      `INSERT INTO temp.removed_case_gene_rows (gene_symbol, row_count)
       SELECT gene_symbol, COUNT(*) FROM variants
       WHERE case_id = ? AND gene_symbol IS NOT NULL AND gene_symbol != ''
       GROUP BY gene_symbol`
    ),
    captureGeneCoords: db.prepare(
      `INSERT OR IGNORE INTO temp.removed_case_gene_coords (gene_symbol, chr, pos, ref, alt)
       SELECT gene_symbol, chr, pos, ref, alt FROM variants
       WHERE case_id = ? AND gene_symbol IS NOT NULL AND gene_symbol != ''`
    ),
    markRecompute: db.prepare(MARK_RECOMPUTE_SQL),
    deleteRecomputeRows: db.prepare(
      `DELETE FROM cohort_variant_summary
       WHERE (chr, pos, ref, alt) IN (SELECT chr, pos, ref, alt FROM temp.removed_case_recompute)`
    ),
    decrementRows: db.prepare(
      `UPDATE cohort_variant_summary AS s SET
         carrier_count = s.carrier_count - 1,
         het_count = s.het_count - k.het,
         hom_count = s.hom_count - k.hom
       FROM temp.removed_case_rows k
       WHERE ${SUMMARY_KEY_JOIN}`
    ),
    dropEmptyRows: db.prepare('DELETE FROM cohort_variant_summary WHERE carrier_count <= 0'),
    insertRecomputeRows: db.prepare(variantSummaryInsertSql(RECOMPUTE_FILTER)),
    // The recompute writes flags from variant_annotations only; the remaining
    // cases' per-case stars / comments / ACMG calls are folded in like the rebuild does.
    applyRecomputedPerCaseFlags: db.prepare(perCaseAnnotationFlagsSql(RECOMPUTE_FILTER)),
    countLostGeneCoords: db.prepare(
      `INSERT INTO temp.removed_case_gene_lost (gene_symbol, lost)
       SELECT k.gene_symbol, COUNT(*) FROM temp.removed_case_gene_coords k
       WHERE NOT EXISTS (
         SELECT 1 FROM variants r JOIN cases rc ON rc.id = r.case_id AND rc.import_status = 'ready'
         WHERE r.chr = k.chr AND r.pos = k.pos AND r.ref = k.ref AND r.alt = k.alt
           AND r.gene_symbol = k.gene_symbol AND rc.genome_build IS @build
       )
       GROUP BY k.gene_symbol`
    ),
    decrementGenes: db.prepare(
      `UPDATE gene_burden_summary AS b SET
         variant_count = b.variant_count - g.row_count,
         affected_case_count = b.affected_case_count - 1,
         unique_variant_count = b.unique_variant_count - COALESCE(
           (SELECT l.lost FROM temp.removed_case_gene_lost l WHERE l.gene_symbol = g.gene_symbol), 0),
         updated_at = CAST(strftime('%s', 'now') AS INTEGER)
       FROM temp.removed_case_gene_rows g
       WHERE b.gene_symbol = g.gene_symbol AND b.genome_build IS @build`
    ),
    dropEmptyGenes: db.prepare(
      `DELETE FROM gene_burden_summary
       WHERE variant_count <= 0
         AND gene_symbol IN (SELECT gene_symbol FROM temp.removed_case_gene_rows)`
    )
  }
}
