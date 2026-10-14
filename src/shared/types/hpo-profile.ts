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
  /** Conservative frequency used for the penalty (0..1); not a disease frequency. */
  frequency: number
  /** The annotation's frequency (0..1, smoothed); the imputed default when not recorded. */
  annotationFrequency: number
  /** False when phenotype.hpoa records no frequency for the annotation. */
  frequencyRecorded: boolean
}

/** A present patient term the disease is annotated NOT to have (the NOT term is it or an ancestor). */
export interface HpoNotConflict {
  patientTerm: string
  patientLabel: string
  diseaseTerm: string
  diseaseLabel: string
}

/** Why a gene got its phenotype score: the best of its diseases. */
export interface HpoExplanation {
  /** Score in [0, 1] (raw, uncalibrated). */
  score: number
  /** Share of reference HPO genes scoring strictly lower for this profile (0..1); no probability. */
  percentile: number
  diseaseId: string
  diseaseLabel: string
  matched: HpoMatch[]
  conflicts: HpoConflict[]
  /** Listed in every exclusion mode; they lower the score only under 'penalty'. */
  notConflicts: HpoNotConflict[]
  /** CNV and STR rows: the locus the score came from (CNV/STR spec §6.1); absent for SNVs. */
  locus?: HpoLocusNote
}

/** The tooltip's locus line (CNV/STR spec §6.3). */
export interface HpoLocusNote {
  kind: 'gene' | 'region' | 'str'
  /** Gene symbol, ISCA region id or STRchive locus id. */
  id: string
  label: string
  /** Dosage score and its source, e.g. `HI 3 (ClinGen 2026-10-14)` or `HI 3 (AnnotSV)`. */
  dosage?: string
  /** Region route: share of the region the CNV covers (0..1). */
  coverage?: number
  /** Indexed genes of the CNV (the Šidák n). */
  diseaseGenes?: number
  /** Protein-coding genes of the CNV. */
  genes?: number
  band?: string
  copies?: string
  motif?: string
  inheritance?: string
  onset?: string
}
