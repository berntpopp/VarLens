/**
 * Score threshold configurations and color mapping for variant annotations
 *
 * Based on clinical interpretation guidelines from RESEARCH.md
 */

interface ScoreThreshold {
  green: number // Threshold for benign/low concern
  orange: number // Threshold for uncertain
  red: number // Threshold for pathogenic/high concern
  direction: 'high-bad' | 'low-bad' // Whether high values are concerning
}

/**
 * Clinical score thresholds for variant pathogenicity assessment
 */
export const SCORE_THRESHOLDS: Record<string, ScoreThreshold> = {
  cadd: { green: 10, orange: 15, red: 20, direction: 'high-bad' },
  revel: { green: 0.5, orange: 0.7, red: 0.8, direction: 'high-bad' },
  spliceai: { green: 0.2, orange: 0.5, red: 0.8, direction: 'high-bad' },
  gnomad_af: { green: 0.01, orange: 0.001, red: 0.0001, direction: 'low-bad' }
}

/**
 * Get Vuetify color name for a score value based on clinical thresholds
 * @param scoreName - Name of the score (cadd, revel, spliceai, gnomad_af)
 * @param value - Score value (null for missing data)
 * @returns Vuetify color name
 */
export function getScoreColor(scoreName: string, value: number | null): string {
  if (value === null || value === undefined) return 'grey'

  const threshold = SCORE_THRESHOLDS[scoreName.toLowerCase()]
  if (threshold === undefined) return 'grey'

  if (threshold.direction === 'high-bad') {
    if (value >= threshold.red) return 'error'
    if (value >= threshold.orange) return 'warning'
    if (value >= threshold.green) return 'success'
    return 'grey-lighten-1'
  } else {
    // low-bad: lower values are more concerning (gnomAD AF)
    if (value <= threshold.red) return 'error'
    if (value <= threshold.orange) return 'warning'
    if (value <= threshold.green) return 'success'
    return 'grey-lighten-1'
  }
}

/**
 * Format score value for display with appropriate precision
 * @param scoreName - Name of the score
 * @param value - Score value (null for missing data)
 * @returns Formatted string
 */
export function formatScoreValue(scoreName: string, value: number | null): string {
  if (value === null || value === undefined) return '-'

  if (scoreName.toLowerCase() === 'gnomad_af') {
    if (value === 0) return '0'
    if (value < 0.0001) return value.toExponential(1)
    if (value < 0.01) return value.toFixed(4)
    return value.toFixed(3)
  }

  if (scoreName.toLowerCase() === 'cadd') {
    return value.toFixed(1)
  }

  return value.toFixed(3)
}
