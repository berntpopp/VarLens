/**
 * Column priority for auto-hide (lower = more important, kept first). Shared by
 * the case and cohort tables; cohort-only keys sit next to their case-table
 * equivalents. At the phone budget (5 columns) the locus stays readable:
 * Gene, Chr, Pos, Impact, ClinVar; Ref/Alt/AF/CADD return at 10. The merged
 * Links column ranks after every data column, and unknown keys (extension
 * columns) get the lowest priority, so link-outs and extensions are the first
 * to be auto-hidden.
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
