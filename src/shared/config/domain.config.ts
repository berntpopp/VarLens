/**
 * Canonical ACMG/AMP 2015 classification labels.
 * Follows ClinVar convention: sentence case for multi-word labels.
 *
 * References:
 * - ACMG/AMP 2015: Richards et al. (PMC4544753)
 * - ClinVar clinical significance: https://www.ncbi.nlm.nih.gov/clinvar/docs/clinsig/
 */
export const ACMG_CLASSIFICATIONS = [
  'Pathogenic',
  'Likely pathogenic',
  'Uncertain significance',
  'Likely benign',
  'Benign'
] as const

export type AcmgClassification = (typeof ACMG_CLASSIFICATIONS)[number]

/** Colorblind-safe palette (Okabe-Ito derived) for ACMG classifications. */
export const ACMG_COLORS: Record<AcmgClassification, string> = {
  Pathogenic: '#C62828',
  'Likely pathogenic': '#D55E00',
  'Uncertain significance': '#757575',
  'Likely benign': '#0072B2',
  Benign: '#009E73'
}

/** Short abbreviations for compact display. */
export const ACMG_ABBREV: Record<AcmgClassification, string> = {
  Pathogenic: 'P',
  'Likely pathogenic': 'LP',
  'Uncertain significance': 'VUS',
  'Likely benign': 'LB',
  Benign: 'B'
}

export const DOMAIN_CONFIG = {
  MAX_CADD_SCORE: 60
} as const

/**
 * Reader-facing text for the per-gene logistic burden warning codes
 * (`src/main/statistics/burden.ts`), shown in the gene burden warning list.
 */
export const ASSOCIATION_WARNING_TEXT: Readonly<Record<string, string>> = {
  NO_SAMPLES: 'no samples to test; logistic test skipped',
  ZERO_BURDEN: 'no qualifying variants in either group; logistic test skipped',
  PERFECT_SEPARATION:
    'carriers occur in only one group (perfect separation); Firth-corrected logistic fit used',
  QUASI_SEPARATION:
    'carriers are nearly confined to one group (quasi-separation); Firth-corrected logistic fit used',
  FIRTH_CONVERGE_FAIL: 'logistic (Firth) fit did not converge; no logistic p-value'
}

/** Run-level warning, prefixed with the number of excluded samples. */
export const ASSOCIATION_MISSING_COVARIATE_TEXT =
  'sample(s) lack a selected covariate (age or metric) and were excluded from the logistic burden test'

/** Status of a tested gene in the burden export. */
export const ASSOCIATION_TESTED_TEXT = 'tested'

/** After "N gene(s)" in the burden summary: untested genes are not listed in the table. */
export const ASSOCIATION_UNTESTED_SUMMARY_TEXT =
  'not tested (no usable site; reasons under warnings and in the export)'

/** Why a gene with no usable site was not tested; used in the warnings and the export. */
export function untestedGeneReason(excluded: {
  missing_call: number
  conflicting_calls: number
  no_called_alleles: number
}): string {
  const total = excluded.missing_call + excluded.conflicting_calls + excluded.no_called_alleles
  if (total === 0) return 'not tested: no qualifying variants'
  return (
    `not tested: all ${total} sites excluded (missing call ${excluded.missing_call}, ` +
    `conflicting calls ${excluded.conflicting_calls}, no called alleles ${excluded.no_called_alleles})`
  )
}
