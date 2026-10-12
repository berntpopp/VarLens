/**
 * Colour mapping and formatting for variant annotation scores; the clinical
 * thresholds live in shared/config/domain.config.ts.
 */
import { EMPTY_VALUE_PLACEHOLDER } from '../config/displayConfig'
import { SCORE_THRESHOLDS } from '../../../shared/config/domain.config'

/**
 * Get the theme colour token for a score value at its clinical thresholds
 * (higher is more concerning); `muted` for missing data or an unknown score.
 * @param scoreName - Name of the score (cadd, revel, spliceai)
 * @param value - Score value (null for missing data)
 */
export function getScoreColor(scoreName: string, value: number | null): string {
  const threshold = SCORE_THRESHOLDS[scoreName.toLowerCase()]
  if (value === null || value === undefined || threshold === undefined) return 'muted'
  if (value >= threshold.red) return 'error'
  if (value >= threshold.orange) return 'warning'
  if (value >= threshold.green) return 'success'
  return 'muted'
}

/**
 * Format score value for display with appropriate precision
 * @param scoreName - Name of the score
 * @param value - Score value (null for missing data)
 * @returns Formatted string
 */
export function formatScoreValue(scoreName: string, value: number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE_PLACEHOLDER

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
