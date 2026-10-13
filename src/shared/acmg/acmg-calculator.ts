/**
 * ACMG/AMP evidence scoring shared by the renderer (evidence editor) and the
 * main process (override check #567, export columns #574): the strength
 * points, the 2015 combination rules and the parse of a stored
 * `acmg_evidence` JSON. Moved from renderer/utils/acmg, which re-exports it.
 */
import type { AcmgClassification } from '../config/domain.config'

/** ACMG/AMP evidence strength levels */
export type EvidenceStrength = 'very_strong' | 'strong' | 'moderate' | 'supporting' | 'stand_alone'

/** Default strength for each evidence code prefix */
export const DEFAULT_STRENGTHS: Record<string, EvidenceStrength> = {
  PVS: 'very_strong',
  PS: 'strong',
  PM: 'moderate',
  PP: 'supporting',
  BA: 'stand_alone',
  BS: 'strong',
  BP: 'supporting'
}

/**
 * Per-code strength overrides based on ClinGen SVI recommendations.
 * These take precedence over prefix-based defaults.
 *
 * PM2: ClinGen SVI recommends using at supporting level only (PM2_Supporting).
 *       See: https://clinicalgenome.org/docs/pm2-recommendation-for-absence-rarity/
 */
export const CODE_STRENGTH_OVERRIDES: Readonly<Record<string, EvidenceStrength>> = {
  PM2: 'supporting'
}

/**
 * Get the recommended default strength for a given ACMG code,
 * considering ClinGen SVI per-code overrides.
 */
export function getDefaultStrength(code: string): EvidenceStrength {
  const override = CODE_STRENGTH_OVERRIDES[code]
  if (override !== undefined) return override
  const prefix = code.replace(/\d+$/, '')
  return DEFAULT_STRENGTHS[prefix] ?? 'supporting'
}

/** Points assigned per evidence strength level (ClinGen Bayesian framework) */
export const EVIDENCE_POINTS: Record<EvidenceStrength, number> = {
  very_strong: 8,
  strong: 4,
  moderate: 2,
  supporting: 1,
  stand_alone: 8 // BA1 = -8, equivalent magnitude to PVS
}

/** The fields of a selected evidence code the scoring reads. */
export interface EvidenceCode {
  code: string
  strength: EvidenceStrength
  confirmed: boolean
}

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
  pathogenic: EvidenceCode[],
  benign: EvidenceCode[]
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

function countByStrength(codes: EvidenceCode[]): StrengthCounts {
  const confirmed = codes.filter((c) => c.confirmed)
  const at = (strength: EvidenceCode['strength']): number =>
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
  pathogenic: EvidenceCode[],
  benign: EvidenceCode[]
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
  pathogenic: EvidenceCode[],
  benign: EvidenceCode[]
): ClassificationResult {
  const points = calculatePoints(pathogenic, benign)

  const hasConfirmed = pathogenic.some((c) => c.confirmed) || benign.some((c) => c.confirmed)

  return {
    ...points,
    classification: hasConfirmed ? classifyByRules(pathogenic, benign) : null
  }
}
