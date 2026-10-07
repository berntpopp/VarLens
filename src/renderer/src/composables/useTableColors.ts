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
   * Map variant impact (HIGH/MODERATE/LOW/MODIFIER) to Vuetify color
   */
  const getImpactColor = (impact: string | null): string => {
    if (impact === null || impact === '') return 'grey'

    const colorMap: Record<string, string> = {
      HIGH: 'error',
      MODERATE: 'warning',
      LOW: 'info',
      MODIFIER: 'grey'
    }

    return colorMap[impact.toUpperCase()] ?? 'grey'
  }

  /**
   * Map CADD phred score to severity color
   * Thresholds: >=25 (high), >=20 (moderate-high), >=15 (moderate), >=10 (low-moderate)
   */
  const getCaddColor = (cadd: number | null): string => {
    if (cadd === null) return 'grey'
    if (cadd >= 25) return 'error'
    if (cadd >= 20) return 'orange'
    if (cadd >= 15) return 'warning'
    if (cadd >= 10) return 'info'
    return 'grey'
  }

  return {
    getClinVarColor,
    getImpactColor,
    getCaddColor
  }
}

// Named exports for direct function import (tree-shaking friendly)
export const { getClinVarColor, getImpactColor, getCaddColor } = useTableColors()
