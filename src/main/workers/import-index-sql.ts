/**
 * Variant index teardown/restore SQL for bulk imports.
 *
 * The import worker drops these indexes before streaming inserts and
 * recreates them once at the end (see import-worker.ts). Re-exported from
 * import-pipeline.ts for existing callers.
 */
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
