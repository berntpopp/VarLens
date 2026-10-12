/**
 * Column priority for auto-hide (lower = more important, kept first). Shared by
 * the case and cohort tables; cohort-only keys sit next to their case-table
 * equivalents. Columns are shown in this order while they fit the table width
 * (see `computeAutoHiddenColumns`); the first `MIN_AUTO_VISIBLE_COLUMNS` are
 * kept even on a phone, so a row always reads Gene, Chr, Pos, Impact, ClinVar,
 * Ref, Alt. The merged Links column ranks after every data column, and unknown
 * keys (extension columns) get the lowest priority, so link-outs and
 * extensions are the first to be auto-hidden.
 */
export const COLUMN_PRIORITY: Readonly<Record<string, number>> = {
  gene_symbol: 1,
  chr: 2,
  pos: 3,
  consequence: 4,
  clinvar: 5,
  ref: 6,
  alt: 7,
  gnomad_af: 8,
  cadd: 9,
  cadd_phred: 9,
  annotations: 10,
  func: 11,
  gt_num: 12,
  carrier_count: 12,
  aa_change: 13,
  cdna: 14,
  cohort_frequency: 14,
  transcript: 15,
  het_count: 15,
  omim_mim_number: 16,
  hpo_sim_score: 17,
  qual: 18,
  moi: 19,
  _links: 20
}

/** Highest-priority data columns shown by default even when they overflow (phones, 200 % zoom). */
export const MIN_AUTO_VISIBLE_COLUMNS = 7
