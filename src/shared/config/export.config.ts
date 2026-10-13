/**
 * Rounding of numeric export columns. Values stay numbers so spreadsheets can
 * sort and filter them; `significantDigits` suits tiny frequencies.
 */
export const EXPORT_NUMBER_FORMATS: Readonly<
  Record<string, { significantDigits: number } | { decimals: number }>
> = {
  gnomad_af: { significantDigits: 3 },
  cadd: { decimals: 2 },
  cadd_phred: { decimals: 2 },
  hpo_sim_score: { decimals: 4 }
}

/**
 * Annotation columns appended to the case and cohort exports, CSV and XLSX,
 * on both backends (#574). A case export reads the case's own (per-case)
 * classification, like the case view's details panel; a cohort export reads
 * the global one of the row's build. The comment is the most recently
 * updated one the panel shows.
 */
export const ANNOTATION_EXPORT_COLUMNS = [
  { key: 'acmg_classification', header: 'ACMG Class' },
  { key: 'acmg_points', header: 'ACMG Points' },
  { key: 'acmg_override_reason', header: 'ACMG Override Reason' },
  { key: 'annotation_comment', header: 'Comment' }
] as const
