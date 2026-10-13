/**
 * Per-carrier call metrics shown in an expanded cohort row (#539), per variant
 * type. Each value is the carrier's own call, never the cohort summary's; a
 * metric the caller did not report shows the shared empty glyph.
 */
import type { CohortCarrier } from '../../../shared/types/cohort'
import { formatBpLength } from '../utils/variant-interval'
import { EMPTY_VALUE_PLACEHOLDER } from './displayConfig'

export interface CarrierMetric {
  key: keyof CohortCarrier
  title: string
  format: (carrier: CohortCarrier) => string
}

const number = (key: keyof CohortCarrier, title: string, digits?: number): CarrierMetric => ({
  key,
  title,
  format: (carrier) => {
    const value = carrier[key]
    if (typeof value !== 'number') return EMPTY_VALUE_PLACEHOLDER
    return digits === undefined ? value.toLocaleString() : value.toFixed(digits)
  }
})

const text = (key: keyof CohortCarrier, title: string): CarrierMetric => ({
  key,
  title,
  format: (carrier) => {
    const value = carrier[key]
    return typeof value === 'string' && value !== '' ? value : EMPTY_VALUE_PLACEHOLDER
  }
})

const END = number('end_pos', 'End')
const LENGTH: CarrierMetric = {
  key: 'sv_length',
  title: 'Length',
  format: (carrier) => formatBpLength(carrier.sv_length)
}
const QUAL = number('qual', 'QUAL', 1)
const FILTER = text('filter', 'Filter')
const CALLER = text('caller', 'Caller')

export const CARRIER_METRICS: Readonly<Record<string, readonly CarrierMetric[]>> = {
  snv: [QUAL, number('gq', 'GQ'), number('dp', 'DP'), FILTER],
  sv: [
    END,
    LENGTH,
    number('sv_support', 'Support'),
    number('sv_vaf', 'VAF', 3),
    QUAL,
    FILTER,
    CALLER
  ],
  cnv: [END, LENGTH, number('copy_number', 'Copy Number'), QUAL, FILTER, CALLER],
  str: [QUAL, FILTER, CALLER]
}

export function carrierMetrics(variantType: string): readonly CarrierMetric[] {
  return CARRIER_METRICS[variantType] ?? CARRIER_METRICS.snv
}
