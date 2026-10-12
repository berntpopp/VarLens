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
