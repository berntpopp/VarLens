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

/**
 * CVD-safe semantic colours, one source for the theme tokens (spread into both
 * Vuetify themes) and for the light SVG / Mol* marks. Every pair of the ACMG and
 * impact scales stays at CIEDE2000 >= 10 under normal, protan, deutan and tritan
 * vision, and every value is >= 4.5:1 on its surface
 * (tests/renderer/plugins/semantic-theme-tokens.test.ts). `error` and `warning`
 * are separated by lightness, not hue, so they survive deuteranopia.
 */
export const SEMANTIC_COLORS = {
  light: {
    error: '#8E1B1B',
    warning: '#9A5B00',
    muted: '#5C6370',
    'acmg-lp': '#B34D00',
    'acmg-lb': '#2B6CB0',
    'acmg-b': '#0B2E6B'
  },
  dark: {
    error: '#FF8A8A',
    warning: '#FFD166',
    muted: '#B4B6BA',
    'acmg-lp': '#FFC078',
    'acmg-lb': '#9CCBFF',
    'acmg-b': '#5C8DFF'
  }
} as const

/**
 * Plot mark for ClinVar records outside the five classes (conflicting, not
 * provided, ...): 3.45:1 on white, ΔE00 >= 10 from the VUS grey under CVD.
 */
export const CLINVAR_OTHER_MARK = '#8A8A8A'

/** Theme colour token per ACMG classification (row, filter and dialog chips alike). */
export const ACMG_COLORS: Record<AcmgClassification, string> = {
  Pathogenic: 'error',
  'Likely pathogenic': 'acmg-lp',
  'Uncertain significance': 'muted',
  'Likely benign': 'acmg-lb',
  Benign: 'acmg-b'
}

/** Theme colour token per VEP impact level; unknown or empty impact is `muted`. */
export const IMPACT_COLORS: Record<string, string> = {
  HIGH: 'error',
  MODERATE: 'warning',
  LOW: 'info',
  MODIFIER: 'muted'
}

/** Theme colour token per zygosity class, on the impact scale. */
export const ZYGOSITY_COLORS = { hom: 'error', het: 'warning', hemi: 'info' } as const

/** Short abbreviations for compact display. */
export const ACMG_ABBREV: Record<AcmgClassification, string> = {
  Pathogenic: 'P',
  'Likely pathogenic': 'LP',
  'Uncertain significance': 'VUS',
  'Likely benign': 'LB',
  Benign: 'B'
}

/**
 * Fill colour of an active ACMG evidence button per strength. Material fills:
 * their bg-* classes set a readable text colour.
 */
export const ACMG_STRENGTH_COLORS = {
  very_strong: 'deep-purple',
  strong: 'orange-darken-2',
  moderate: 'amber-darken-1',
  supporting: 'blue-grey',
  stand_alone: 'red-darken-2'
} as const

/** Clinical score thresholds (higher is more concerning): green = low concern, orange = uncertain, red = high concern. */
export const SCORE_THRESHOLDS: Record<string, { green: number; orange: number; red: number }> = {
  cadd: { green: 10, orange: 15, red: 20 },
  revel: { green: 0.5, orange: 0.7, red: 0.8 },
  spliceai: { green: 0.2, orange: 0.5, red: 0.8 }
}

/** Why the quick-classify chips are disabled: stored evidence decides the class. */
export const ACMG_EVIDENCE_LOCK_HINT = 'Set from evidence: use Override in the Evidence editor.'

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
