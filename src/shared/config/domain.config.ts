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

/** Why the quick-classify chips are disabled: stored evidence decides the class. */
export const ACMG_EVIDENCE_LOCK_HINT = 'Set from evidence: use Override in the Evidence editor.'

export const DOMAIN_CONFIG = {
  MAX_CADD_SCORE: 60
} as const
