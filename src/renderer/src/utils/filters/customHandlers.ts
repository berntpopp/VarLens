/**
 * Custom numeric input handlers
 *
 * Consolidates the duplicate handleCustomXxxChange pattern from CohortTable.vue.
 * Three identical functions (handleCustomCohortFreqChange, handleCustomGnomadAfChange,
 * handleCustomCaddChange) are now unified into a single parameterized function.
 *
 * DRY-04: Eliminate duplicate handleCustomXxxChange functions.
 */

import type { Ref } from 'vue'

/**
 * Conversion mode for custom numeric input
 * - 'percentage': User enters 0-100, stored as 0-1 (e.g., cohort frequency, gnomAD AF)
 * - 'raw': No conversion (e.g., CADD score, carrier count)
 */
export type ConversionMode = 'percentage' | 'raw'

/**
 * Parameters for handling custom numeric input
 */
export interface HandleCustomChangeParams {
  /** Raw input value from user */
  value: string | number | null
  /** Target filter ref to update */
  targetFilter: Ref<number | null>
  /** Preset ref to clear when custom value is used */
  presetRef: Ref<number | null>
  /** How to convert the value */
  conversionMode: ConversionMode
  /** Minimum valid value (default: 0) */
  minValue?: number
}

/**
 * Handle custom numeric input with preset clearing and optional unit conversion
 *
 * Consolidates the duplicate handleCustomCohortFreqChange, handleCustomGnomadAfChange,
 * and handleCustomCaddChange functions (DRY-04).
 *
 * @param params - Handler parameters
 *
 * @example
 * ```typescript
 * // For CADD score (raw value):
 * handleCustomNumericChange({
 *   value: event.target.value,
 *   targetFilter: filters.value.minCadd,
 *   presetRef: selectedCaddPreset,
 *   conversionMode: 'raw',
 *   minValue: 0
 * })
 * ```
 */
export function handleCustomNumericChange({
  value,
  targetFilter,
  presetRef,
  conversionMode,
  minValue = 0
}: HandleCustomChangeParams): void {
  const numValue = typeof value === 'string' ? parseFloat(value) : value

  if (numValue !== null && !Number.isNaN(numValue) && numValue >= minValue) {
    // Apply conversion if needed
    targetFilter.value = conversionMode === 'percentage' ? numValue / 100 : numValue
    presetRef.value = null // Clear preset when custom is used
  } else {
    // If cleared or invalid, only clear the filter if no preset is active
    if (presetRef.value === null) {
      targetFilter.value = null
    }
  }
}
