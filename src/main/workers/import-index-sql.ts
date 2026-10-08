/**
 * Variant index teardown/restore SQL for bulk imports.
 *
 * The import worker drops these indexes before streaming inserts and
 * recreates them once at the end (see import-worker.ts). Re-exported from
 * import-pipeline.ts for existing callers.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'

import * as chrRank from '../database/chr-rank-indexes'

export const DROP_INDEXES = `
  DROP INDEX IF EXISTS idx_variants_gene;
  DROP INDEX IF EXISTS idx_variants_pos;
  DROP INDEX IF EXISTS idx_variants_filters;
  DROP INDEX IF EXISTS idx_variants_chr_pos_ref_alt;
  DROP INDEX IF EXISTS idx_vt_selected;
  DROP INDEX IF EXISTS idx_vt_transcript;
  DROP INDEX IF EXISTS idx_variants_filter_covering;
  DROP INDEX IF EXISTS idx_variants_case_coords;
  DROP INDEX IF EXISTS idx_variants_gene_notnull;
  DROP INDEX IF EXISTS ${chrRank.CHR_RANK_VARIANTS_INDEX};
`

export const RECREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_variants_gene ON variants(gene_symbol);
  CREATE INDEX IF NOT EXISTS idx_variants_pos ON variants(chr, pos);
  CREATE INDEX IF NOT EXISTS idx_variants_filters ON variants(gnomad_af, cadd);
  CREATE INDEX IF NOT EXISTS idx_variants_chr_pos_ref_alt ON variants(chr, pos, ref, alt);
  CREATE INDEX IF NOT EXISTS idx_vt_selected ON variant_transcripts(variant_id, is_selected);
  CREATE INDEX IF NOT EXISTS idx_vt_transcript ON variant_transcripts(transcript_id);
  CREATE INDEX IF NOT EXISTS idx_variants_filter_covering ON variants(case_id, consequence, func, clinvar);
  CREATE INDEX IF NOT EXISTS idx_variants_case_coords ON variants(case_id, chr, pos, ref, alt);
  CREATE INDEX IF NOT EXISTS idx_variants_gene_notnull ON variants(gene_symbol) WHERE gene_symbol IS NOT NULL;
  ${chrRank.CREATE_CHR_RANK_VARIANTS_INDEX_SQL};
`

/**
 * True when an index the import session drops is absent. A session killed
 * between dropping them and setting its open-session marker leaves no other
 * trace (#505), so startup asks the schema, not the marker.
 */
export function sessionIndexesMissing(db: DatabaseType): boolean {
  const names = [...DROP_INDEXES.matchAll(/IF EXISTS (\S+);/g)].map((m) => m[1])
  const found = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master
       WHERE type = 'index' AND name IN (${names.map(() => '?').join(', ')})`
    )
    .get(...names) as { c: number }
  return found.c < names.length
}

/**
 * Dropping the indexes above and rebuilding them at the end pays off for a
 * bulk load, not for a few files into a large database: the rebuild reads
 * every variant there is. Measured, files into 20 exomes (1.2M variants):
 * 1 file 10.8 s dropped / 6.2 s kept, 5 files 25.8 / 19.2 s, 10 files
 * 34.3 / 34.7 s (break-even at +50 %); with nothing to import at all into
 * 100 exomes, 52.9 s / 15.5 s. Keep them while the session adds at most a
 * quarter to the cases already stored.
 */
export const KEEP_INDEXES_MIN_CASES_PER_FILE = 4

export function keepsIndexesForSession(existingCases: number, files: number): boolean {
  return existingCases >= KEEP_INDEXES_MIN_CASES_PER_FILE * files
}
