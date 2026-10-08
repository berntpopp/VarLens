import type { AcmgEvidenceCode } from './types'
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import { EVIDENCE_POINTS } from './types'

export interface PointBreakdown {
  pathogenicPoints: number
  benignPoints: number
  netPoints: number
}

export interface ClassificationResult extends PointBreakdown {
  classification: AcmgClassification | null
}

/**
 * Calculate pathogenic and benign point totals from evidence codes.
 * Only counts codes where confirmed === true.
 */
export function calculatePoints(
  pathogenic: AcmgEvidenceCode[],
  benign: AcmgEvidenceCode[]
): PointBreakdown {
  const pathogenicPoints = pathogenic
    .filter((c) => c.confirmed)
    .reduce((sum, c) => sum + EVIDENCE_POINTS[c.strength], 0)

  const benignPoints = benign
    .filter((c) => c.confirmed)
    .reduce((sum, c) => sum + EVIDENCE_POINTS[c.strength], 0)

  return {
    pathogenicPoints,
    benignPoints,
    netPoints: pathogenicPoints - benignPoints
  }
}

/**
 * Count confirmed codes by strength category.
 */
interface StrengthCounts {
  veryStrong: number
  strong: number
  moderate: number
  supporting: number
  standAlone: number
}

function countByStrength(codes: AcmgEvidenceCode[]): StrengthCounts {
  const confirmed = codes.filter((c) => c.confirmed)
  const at = (strength: AcmgEvidenceCode['strength']): number =>
    confirmed.filter((c) => c.strength === strength).length
  // Stand-Alone is a rule for BA1 only. Evidence stored with it on another
  // criterion counts as very strong, the level with the same 8 points.
  const standAlone = confirmed.filter(
    (c) => c.strength === 'stand_alone' && c.code === 'BA1'
  ).length
  return {
    veryStrong: at('very_strong') + at('stand_alone') - standAlone,
    strong: at('strong'),
    moderate: at('moderate'),
    supporting: at('supporting'),
    standAlone
  }
}

/**
 * ACMG/AMP 2015 rule-based classification.
 *
 * Pathogenic requires one of:
 *   1. PVS + ≥1 PS
 *   2. PVS + ≥2 PM
 *   3. PVS + 1 PM + 1 PP
 *   4. PVS + ≥2 PP
 *   5. ≥2 PS
 *   6. 1 PS + ≥3 PM
 *   7. 1 PS + 2 PM + ≥2 PP
 *   8. 1 PS + 1 PM + ≥4 PP
 *
 * Likely Pathogenic requires one of:
 *   1. PVS + 1 PM
 *   2. PVS + 1 PP
 *   3. 1 PS + 1-2 PM
 *   4. 1 PS + ≥2 PP
 *   5. ≥3 PM
 *   6. 2 PM + ≥2 PP
 *   7. 1 PM + ≥4 PP
 *
 * Benign requires one of (checked first — BA1/strong benign always wins):
 *   1. BA1 (stand-alone)
 *   2. ≥2 BS
 *
 * Likely Benign requires one of (checked after pathogenic/LP to avoid
 * weak benign evidence overriding strong pathogenic combinations):
 *   1. 1 BS + 1 BP
 *   2. ≥2 BP
 *
 * Otherwise: VUS
 */
export function classifyByRules(
  pathogenic: AcmgEvidenceCode[],
  benign: AcmgEvidenceCode[]
): AcmgClassification {
  const p = countByStrength(pathogenic)
  const counted = countByStrength(benign)
  // The benign rules know only BS and BP. A benign criterion raised to Very
  // Strong still counts as BS, one set to Moderate as BP, so that changing a
  // strength never drops the criterion from the rule check.
  const b = {
    standAlone: counted.standAlone,
    strong: counted.strong + counted.veryStrong,
    supporting: counted.supporting + counted.moderate
  }

  // --- Benign stand-alone (BA1) and strong benign (≥2 BS) always win ---
  if (b.standAlone >= 1) return 'Benign'
  if (b.strong >= 2) return 'Benign'

  // --- Pathogenic rules (evaluated before Likely Benign to avoid
  //     weak benign evidence overriding strong pathogenic combinations) ---
  // PVS1 combinations
  if (p.veryStrong >= 1) {
    if (p.strong >= 1) return 'Pathogenic' // PVS + PS
    if (p.moderate >= 2) return 'Pathogenic' // PVS + 2 PM
    if (p.moderate >= 1 && p.supporting >= 1) return 'Pathogenic' // PVS + PM + PP
    if (p.supporting >= 2) return 'Pathogenic' // PVS + 2 PP
  }
  // Multiple strong
  if (p.strong >= 2) return 'Pathogenic'
  // PS + multiple PM/PP
  if (p.strong >= 1) {
    if (p.moderate >= 3) return 'Pathogenic' // PS + 3 PM
    if (p.moderate >= 2 && p.supporting >= 2) return 'Pathogenic' // PS + 2 PM + 2 PP
    if (p.moderate >= 1 && p.supporting >= 4) return 'Pathogenic' // PS + 1 PM + 4 PP
  }

  // --- Likely Pathogenic rules ---
  if (p.veryStrong >= 1) {
    if (p.moderate >= 1) return 'Likely pathogenic' // PVS + PM
    if (p.supporting >= 1) return 'Likely pathogenic' // PVS + PP
  }
  if (p.strong >= 1) {
    if (p.moderate >= 1) return 'Likely pathogenic' // PS + 1-2 PM
    if (p.supporting >= 2) return 'Likely pathogenic' // PS + 2 PP
  }
  if (p.moderate >= 3) return 'Likely pathogenic' // 3 PM
  if (p.moderate >= 2 && p.supporting >= 2) return 'Likely pathogenic' // 2 PM + 2 PP
  if (p.moderate >= 1 && p.supporting >= 4) return 'Likely pathogenic' // 1 PM + 4 PP

  // --- Likely Benign rules (after pathogenic/LP to avoid overriding strong pathogenic evidence) ---
  if (b.strong >= 1 && b.supporting >= 1) return 'Likely benign'
  if (b.supporting >= 2) return 'Likely benign'

  return 'Uncertain significance'
}

/**
 * Calculate classification from evidence code arrays using ACMG/AMP 2015 rules.
 * Returns null classification if no confirmed codes exist.
 */
export function calculateClassification(
  pathogenic: AcmgEvidenceCode[],
  benign: AcmgEvidenceCode[]
): ClassificationResult {
  const points = calculatePoints(pathogenic, benign)

  const hasConfirmed = pathogenic.some((c) => c.confirmed) || benign.some((c) => c.confirmed)

  return {
    ...points,
    classification: hasConfirmed ? classifyByRules(pathogenic, benign) : null
  }
}
