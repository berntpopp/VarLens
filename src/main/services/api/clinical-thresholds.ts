/**
 * Clinical score thresholds and classification functions
 *
 * Based on ACMG guidelines and ClinGen expert panel specifications.
 * Used for color-coding prediction scores in variant annotation UI.
 *
 * References:
 * - CADD: >= 20 suggests pathogenicity
 * - REVEL: Pejaver et al. 2022 calibration study
 * - SpliceAI: Walker et al. 2023 PP3/BP4 thresholds
 * - gnomAD: ACMG PM2/BA1 frequency criteria
 */

/**
 * Clinical thresholds for prediction scores
 * Calibrated values from published literature
 */
export const CLINICAL_THRESHOLDS = {
  CADD: {
    /** CADD >= 20 suggests pathogenicity */
    pathogenic: 20,
    /** CADD 10-20 uncertain significance */
    uncertain: 10,
    /** CADD <= 10 suggests benign */
    benign: 10
  },
  REVEL: {
    pathogenic: {
      /** PP3 Supporting >= 0.644 */
      supporting: 0.644,
      /** PP3 Moderate >= 0.773 */
      moderate: 0.773,
      /** PP3 Strong >= 0.932 */
      strong: 0.932
    },
    benign: {
      /** BP4 Supporting <= 0.290 */
      supporting: 0.29,
      /** BP4 Moderate <= 0.183 */
      moderate: 0.183,
      /** BP4 Strong <= 0.016 */
      strong: 0.016
    }
  },
  SPLICEAI: {
    /** PP3 threshold (Walker et al. 2023) */
    pathogenic: 0.2,
    /** BP4 threshold */
    benign: 0.1,
    /** Delta >= 0.5 high confidence splice impact */
    maxDelta: 0.5
  },
  GNOMAD_AF: {
    /** AF < 1% considered rare */
    rare: 0.01,
    /** AF < 0.1% very rare */
    veryRare: 0.001,
    /** AF > 5% likely benign (PM2/BA1) */
    common: 0.05
  }
} as const

export type ScoreClassification = 'pathogenic' | 'uncertain' | 'benign' | 'unknown'
export type FrequencyClassification = 'common' | 'rare' | 'veryRare' | 'unknown'

/**
 * Classify CADD score based on thresholds
 */
export function getCADDClassification(score: number | undefined): ScoreClassification {
  if (score === undefined || score === null) return 'unknown'
  if (score >= CLINICAL_THRESHOLDS.CADD.pathogenic) return 'pathogenic'
  if (score <= CLINICAL_THRESHOLDS.CADD.benign) return 'benign'
  return 'uncertain'
}

/**
 * Classify REVEL score based on thresholds
 */
export function getREVELClassification(score: number | undefined): ScoreClassification {
  if (score === undefined || score === null) return 'unknown'
  if (score >= CLINICAL_THRESHOLDS.REVEL.pathogenic.supporting) return 'pathogenic'
  if (score <= CLINICAL_THRESHOLDS.REVEL.benign.supporting) return 'benign'
  return 'uncertain'
}

/**
 * Calculate maximum delta score from SpliceAI predictions
 * SpliceAI provides 4 delta scores for different splice site changes
 *
 * @returns Maximum delta score (0-1)
 */
export function getSpliceAIMaxDelta(
  ds_ag: number | undefined,
  ds_al: number | undefined,
  ds_dg: number | undefined,
  ds_dl: number | undefined
): number | undefined {
  const scores = [ds_ag, ds_al, ds_dg, ds_dl].filter(
    (s): s is number => s !== undefined && s !== null
  )

  if (scores.length === 0) return undefined

  return Math.max(...scores)
}

/**
 * Classify SpliceAI max delta score
 */
export function getSpliceAIClassification(maxDelta: number | undefined): ScoreClassification {
  if (maxDelta === undefined || maxDelta === null) return 'unknown'
  if (maxDelta >= CLINICAL_THRESHOLDS.SPLICEAI.pathogenic) return 'pathogenic'
  if (maxDelta <= CLINICAL_THRESHOLDS.SPLICEAI.benign) return 'benign'
  return 'uncertain'
}

/**
 * Classify gnomAD allele frequency
 */
export function getGnomADClassification(af: number | undefined): FrequencyClassification {
  if (af === undefined || af === null) return 'unknown'
  if (af >= CLINICAL_THRESHOLDS.GNOMAD_AF.common) return 'common'
  if (af < CLINICAL_THRESHOLDS.GNOMAD_AF.veryRare) return 'veryRare'
  if (af < CLINICAL_THRESHOLDS.GNOMAD_AF.rare) return 'rare'
  return 'unknown'
}
