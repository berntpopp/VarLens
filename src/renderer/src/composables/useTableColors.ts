/**
 * useTableColors composable
 *
 * Shared color mapping utilities for variant data visualization.
 * Maps clinical significance, impact, and scores to Vuetify colors.
 * DRY extraction from VariantTable.vue and CohortTableRow.vue.
 *
 * @example
 * ```vue
 * import { useTableColors } from '@/composables/useTableColors'
 * const { getClinVarColor, getImpactColor, getCaddColor } = useTableColors()
 * ```
 */

import { IMPACT_COLORS, SCORE_THRESHOLDS } from '../../../shared/config/domain.config'
import { clinvarColorToken } from '../../../shared/config/severity.config'

export interface UseTableColorsReturn {
  getClinVarColor: (significance: string | null) => string
  getImpactColor: (impact: string | null) => string
  getCaddColor: (cadd: number | null) => string
}

export function useTableColors(): UseTableColorsReturn {
  /**
   * Map ClinVar significance to a Vuetify color: the colour of its normalised
   * category in the shared severity configuration, whatever the spelling.
   */
  const getClinVarColor = (significance: string | null): string => clinvarColorToken(significance)

  /**
   * Map variant impact (HIGH/MODERATE/LOW/MODIFIER) to its theme colour token
   */
  const getImpactColor = (impact: string | null): string =>
    IMPACT_COLORS[(impact ?? '').toUpperCase()] ?? IMPACT_COLORS.MODIFIER

  /**
   * Map CADD phred score to a severity token on the impact scale, at the
   * clinical CADD thresholds shared with the details panel.
   */
  const getCaddColor = (cadd: number | null): string => {
    const { red, orange, green } = SCORE_THRESHOLDS.cadd
    if (cadd === null) return 'muted'
    if (cadd >= red) return 'error'
    if (cadd >= orange) return 'warning'
    if (cadd >= green) return 'info'
    return 'muted'
  }

  return {
    getClinVarColor,
    getImpactColor,
    getCaddColor
  }
}

// Named exports for direct function import (tree-shaking friendly)
export const { getClinVarColor, getImpactColor, getCaddColor } = useTableColors()
