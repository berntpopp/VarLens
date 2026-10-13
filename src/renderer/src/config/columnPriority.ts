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
  // Cohort-only: carriers and cohort frequency outrank gnomAD AF (product decision 2026-10-12)
  carrier_count: 8,
  cohort_frequency: 9,
  gnomad_af: 10,
  cadd: 11,
  cadd_phred: 11,
  annotations: 12,
  func: 13,
  gt_num: 14,
  aa_change: 15,
  cdna: 16,
  transcript: 17,
  het_count: 17,
  omim_mim_number: 18,
  hpo_sim_score: 19,
  hpo_match: 19,
  qual: 20,
  moi: 21,
  _links: 22
}

/** Highest-priority data columns shown by default even when they overflow (phones, 200 % zoom). */
export const MIN_AUTO_VISIBLE_COLUMNS = 7
