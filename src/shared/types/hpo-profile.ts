/** Phenotype scoring v2 contracts (spec .planning/specs/2026-10-14-hpo-phenotype-scoring-v2.md). */

/** Optional status flags for `caseMetadata.assignHpoTerm` (upsert). */
export interface HpoTermFlags {
  excluded?: boolean
  key?: boolean
}

/** One case term as the scorer sees it. Unlisted terms are not assessed. */
export interface HpoProfileTerm {
  hpoId: string
  excluded: boolean
  key: boolean
}

/** A present patient term and the best disease term it matched. */
export interface HpoMatch {
  patientTerm: string
  patientLabel: string
  diseaseTerm: string
  diseaseLabel: string
  key: boolean
  /** Annotation frequency used for the match (0..1, smoothed). */
  frequency: number
}

/** An excluded patient term contradicted by a disease annotation (descendant or equal). */
export interface HpoConflict {
  excludedTerm: string
  excludedLabel: string
  diseaseTerm: string
  diseaseLabel: string
  /** Conservative frequency used for the penalty (0..1). */
  frequency: number
}

/** Why a gene got its phenotype score: the best of its diseases. */
export interface HpoExplanation {
  /** Score in [0, 1] (raw, uncalibrated). */
  score: number
  /** Share of the case's genes with a lower score (0..1); not a probability. */
  percentile: number
  diseaseId: string
  diseaseLabel: string
  matched: HpoMatch[]
  conflicts: HpoConflict[]
}
