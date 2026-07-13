// ---------------------------------------------------------------------------
// Shared column constants and helpers for Postgres import repositories.
//
// PostgresVcfImportRepository (COPY path, Phase 16+) and
// PostgresJsonImportRepository (legacy jsonb_to_recordset path) both write
// to the same schema, so the column lists and id helpers live here as the
// single source of truth.
//
// `search_document` is intentionally excluded from VARIANT_BASE_COLUMNS:
// since Phase 16.1 it is a STORED generated column on variants/variant_sv/
// variant_str (see scripts/postgres/init-db/16-phase16-search-document-fns.sql).
// Postgres rejects writes to GENERATED ALWAYS columns, so any COPY/INSERT
// must omit it.
// ---------------------------------------------------------------------------

import { encodeText, encodeInteger, encodeFloat, type CopyColumnEncoder } from './copy-text-encoder'

export const VARIANT_BASE_COLUMNS = [
  'case_id',
  'chr',
  'pos',
  'ref',
  'alt',
  'gene_symbol',
  'omim_mim_number',
  'consequence',
  'gnomad_af',
  'cadd',
  'clinvar',
  'gt_num',
  'func',
  'qual',
  'hpo_sim_score',
  'transcript',
  'cdna',
  'aa_change',
  'moi',
  'gq',
  'dp',
  'ad_ref',
  'ad_alt',
  'ab',
  'filter',
  'info_json',
  'source_format',
  'variant_type',
  'end_pos',
  'sv_type',
  'sv_length',
  'caller'
] as const

export const VARIANT_TRANSCRIPT_COLUMNS = [
  'variant_id',
  'transcript_id',
  'gene_symbol',
  'consequence',
  'func',
  'cdna',
  'aa_change',
  'hpo_sim_score',
  'moi',
  'is_selected',
  'is_mane_select',
  'is_canonical'
] as const

export const VARIANT_SV_COLUMNS = [
  'variant_id',
  'sv_is_precise',
  'cipos_left',
  'cipos_right',
  'ciend_left',
  'ciend_right',
  'support',
  'coverage',
  'strand',
  'stdev_len',
  'stdev_pos',
  'vaf',
  'dr',
  'dv',
  'pe_support',
  'sr_support',
  'event_id',
  'mate_id'
] as const

export const VARIANT_CNV_COLUMNS = [
  'variant_id',
  'copy_number',
  'copy_number_quality',
  'homozygosity_ref',
  'homozygosity_alt',
  'sm',
  'bin_count'
] as const

export const VARIANT_STR_COLUMNS = [
  'variant_id',
  'repeat_id',
  'variant_catalog_id',
  'repeat_unit',
  'display_repeat_unit',
  'ref_copies',
  'alt_copies',
  'repeat_length',
  'str_status',
  'normal_max',
  'pathologic_min',
  'disease',
  'inheritance_mode',
  'source_display',
  'rank_score',
  'locus_coverage',
  'support_type',
  'confidence_interval'
] as const

// ---------------------------------------------------------------------------
// COPY FROM STDIN column lists (Phase 16).
//
// VARIANT_COPY_COLUMNS prepends `id` because the COPY path supplies pre-allocated
// ids (via nextval on variants_id_seq) instead of relying on BIGSERIAL defaults —
// this is what lets the extension tables' COPY rows reference the correct
// variant_id without a per-row RETURNING round-trip. VARIANT_BASE_COLUMNS already
// starts with `case_id`, so we do NOT include `case_id` again.
//
// The four extension-table COPY column lists are intentional aliases of the
// existing `_COLUMNS` constants — they already begin with `variant_id` and
// already exclude `search_document`. Phase 16.1 made `search_document` a
// STORED generated column on variants/variant_sv/variant_str, so it is
// populated inline at COPY time and must be excluded from any write list
// (Postgres rejects writes to GENERATED ALWAYS columns).
// ---------------------------------------------------------------------------

export const VARIANT_COPY_COLUMNS = ['id', ...VARIANT_BASE_COLUMNS] as const
export const VARIANT_TRANSCRIPT_COPY_COLUMNS = VARIANT_TRANSCRIPT_COLUMNS
export const VARIANT_SV_COPY_COLUMNS = VARIANT_SV_COLUMNS
export const VARIANT_CNV_COPY_COLUMNS = VARIANT_CNV_COLUMNS
export const VARIANT_STR_COPY_COLUMNS = VARIANT_STR_COLUMNS

// ---------------------------------------------------------------------------
// Per-column encoder map (Phase 16).
//
// Covers every column appearing in any of the five COPY column lists above.
// Source of truth for column → Postgres type:
// scripts/postgres/init-db/12-phase7-variants.sql.
//
// Mapping rules:
//   TEXT                                  → encodeText
//   BIGINT / BIGSERIAL / INTEGER          → encodeInteger
//   DOUBLE PRECISION                      → encodeFloat
//
// Note: `is_selected`, `is_mane_select`, `is_canonical`, `sv_is_precise` are
// stored as INTEGER (0/1) in the schema, NOT BOOLEAN. They use encodeInteger;
// using encodeBoolean would throw because the encoder is strict.
//
// Where a column name appears in multiple tables (e.g. `gene_symbol`,
// `consequence`, `func`, `cdna`, `aa_change`, `hpo_sim_score`, `moi`,
// `variant_id`), the type is identical across tables, so a single shared
// entry is correct.
// ---------------------------------------------------------------------------

export const VARIANT_COLUMN_ENCODERS: Record<string, CopyColumnEncoder> = {
  // variants
  id: encodeInteger,
  case_id: encodeInteger,
  chr: encodeText,
  pos: encodeInteger,
  ref: encodeText,
  alt: encodeText,
  gene_symbol: encodeText,
  omim_mim_number: encodeText,
  consequence: encodeText,
  gnomad_af: encodeFloat,
  cadd: encodeFloat,
  clinvar: encodeText,
  gt_num: encodeText,
  func: encodeText,
  qual: encodeFloat,
  hpo_sim_score: encodeFloat,
  transcript: encodeText,
  cdna: encodeText,
  aa_change: encodeText,
  moi: encodeText,
  gq: encodeFloat,
  dp: encodeInteger,
  ad_ref: encodeInteger,
  ad_alt: encodeInteger,
  ab: encodeFloat,
  filter: encodeText,
  info_json: encodeText,
  source_format: encodeText,
  variant_type: encodeText,
  end_pos: encodeInteger,
  sv_type: encodeText,
  sv_length: encodeInteger,
  caller: encodeText,
  // variant_transcripts
  variant_id: encodeInteger,
  transcript_id: encodeText,
  is_selected: encodeInteger,
  is_mane_select: encodeInteger,
  is_canonical: encodeInteger,
  // variant_sv
  sv_is_precise: encodeInteger,
  cipos_left: encodeInteger,
  cipos_right: encodeInteger,
  ciend_left: encodeInteger,
  ciend_right: encodeInteger,
  support: encodeInteger,
  coverage: encodeText,
  strand: encodeText,
  stdev_len: encodeFloat,
  stdev_pos: encodeFloat,
  vaf: encodeFloat,
  dr: encodeInteger,
  dv: encodeInteger,
  pe_support: encodeInteger,
  sr_support: encodeInteger,
  event_id: encodeText,
  mate_id: encodeText,
  // variant_cnv
  copy_number: encodeInteger,
  copy_number_quality: encodeInteger,
  homozygosity_ref: encodeFloat,
  homozygosity_alt: encodeFloat,
  sm: encodeFloat,
  bin_count: encodeInteger,
  // variant_str
  repeat_id: encodeText,
  variant_catalog_id: encodeText,
  repeat_unit: encodeText,
  display_repeat_unit: encodeText,
  ref_copies: encodeFloat,
  alt_copies: encodeText,
  repeat_length: encodeInteger,
  str_status: encodeText,
  normal_max: encodeInteger,
  pathologic_min: encodeInteger,
  disease: encodeText,
  inheritance_mode: encodeText,
  source_display: encodeText,
  rank_score: encodeText,
  locus_coverage: encodeFloat,
  support_type: encodeText,
  confidence_interval: encodeText
}

// ---------------------------------------------------------------------------
// Shared helper: convert a pg RETURNING id value to a JS number.
// Throws if the value is not a finite number or a numeric string —
// a NaN would silently poison every FK that depends on it.
// ---------------------------------------------------------------------------

export function toNumericId(value: unknown): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    if (!Number.isNaN(n)) return n
  }
  throw new Error(`Expected numeric id, received: ${String(value)}`)
}
