// Records exchanged between the simulation runner and the statistics/report layer.
// They hold no coordinates or row-level background data — only ranks and counts.

export type CaseMode = 'AD' | 'AR_HOM' | 'AR_COMPHET' | 'XLD' | 'XLR'
export const CASE_MODES: readonly CaseMode[] = ['AD', 'AR_HOM', 'AR_COMPHET', 'XLD', 'XLR']
/** X-linked modes, reported together as the XL stratum (#583). */
export const XL_MODES: readonly CaseMode[] = ['XLD', 'XLR']

export type ScenarioId =
  'primary' | 'clinvar_visible' | 'pheno_free' | 'pheno_shuffled' | 'missingness' | 'pheno_enriched'

/** Severity order lof > missense > inframe > other (spec §11.2). */
export type ConsequenceClass = 'lof' | 'missense' | 'inframe' | 'other'
export const CONSEQUENCE_CLASSES: readonly ConsequenceClass[] = [
  'lof',
  'missense',
  'inframe',
  'other'
]

/**
 * Position of one causal allele in a scorer's production ordering.
 * `rank` is 1-based, or null when the allele is absent (gated out).
 * `higher` = rows ranked strictly before it (earlier pin partition or greater score);
 * `equal` = OTHER rows in the same pin partition with the same score (itself excluded).
 */
export interface AlleleRank {
  rank: number | null
  higher: number
  equal: number
}

export interface CaseResult {
  caseId: string
  scorer: string
  scenario: ScenarioId
  fold: number
  mode: CaseMode
  consequenceClass: ConsequenceClass
  bg: string
  gene: string
  newSince2024: boolean
  /** Every causal allele is an SNV (CADD is real for all of them; the CADD-imputation check). */
  snvOnly?: boolean
  /** One entry per causal allele (two for AR_COMPHET). */
  alleles: AlleleRank[]
  /** Benign decoys among the first 10 rows. */
  decoysTop10: number
  /** Eligible (post-gate) rows of the case. */
  eligible: number
  /** Per causal allele: passed the scorer's gate. */
  causalEligible: boolean[]
}

/** Counts behind one tuned bin (spec §11.1). */
export interface BinSupport {
  group: string
  bin: string
  isReference: boolean
  /** Best-supported bin of its group (0 points by construction, spec §11.9). */
  isAnchor?: boolean
  /** false: a non-tuned template prior (ClinVar bins other than P/LP, spec §15). */
  tuned?: boolean
  a: number
  b: number
  points: number
  supported: boolean
  /** Optional bootstrap interval of the unrounded points. */
  lo?: number
  hi?: number
}

export interface ConcordanceCheck {
  field: string
  metric: string
  value: number
  threshold: string
  accepted: boolean
}

export interface RunManifest {
  run: string
  createdAt: string
  quick: boolean
  /** Annotation acceptance was not fully evaluable (spec §11.4): never SHIP. */
  provisional?: boolean
  seeds: Record<string, number>
  bootstrapReps: number
  inputHashes: Record<string, string>
  /** Pool selection funnel in order: step label → remaining count. */
  poolFunnel: Array<{ step: string; count: number }>
  concordance: {
    checks: ConcordanceCheck[]
    /** Share of the pool excluded for an unmapped `func` term (§11.4; > 0.05 flags a threat). */
    funcUnmappedShare: number
    disabledGroups: string[]
  }
  tuned: { A: number; B: number; bins: BinSupport[] }
  /** Pre-registered rerun (#584): the ruleset file evaluated unchanged; nothing was tuned. */
  frozenRuleset?: string
  scorers: {
    /** "Tier 1 candidates" — the ship comparator. */
    reference: string
    /** Simulation-tuned evidence scorer. */
    candidate: string
    ablations: string[]
    all: Array<{ id: string; label: string }>
  }
}
