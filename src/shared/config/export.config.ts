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
 * classification, like the case view's details panel, and both comments; a
 * cohort export the global classification and comment of the row's build.
 */
const ACMG_EXPORT_COLUMNS = [
  { key: 'acmg_classification', header: 'ACMG Class' },
  { key: 'acmg_points', header: 'ACMG Points' },
  { key: 'acmg_override_reason', header: 'ACMG Override Reason' }
] as const

export const CASE_ANNOTATION_EXPORT_COLUMNS = [
  ...ACMG_EXPORT_COLUMNS,
  { key: 'case_comment', header: 'Case Comment' },
  { key: 'global_comment', header: 'Global Comment' }
] as const

export const COHORT_ANNOTATION_EXPORT_COLUMNS = [
  ...ACMG_EXPORT_COLUMNS,
  { key: 'global_comment', header: 'Global Comment' }
] as const
