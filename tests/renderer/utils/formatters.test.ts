import { describe, it, expect } from 'vitest'
import { EMPTY_VALUE_PLACEHOLDER } from '../../../src/renderer/src/utils/formatters'
import { formatScoreValue } from '../../../src/renderer/src/utils/scoreThresholds'
import {
  formatScientific,
  formatCaddScore,
  formatScore
} from '../../../src/renderer/src/composables/useTableFormatters'

describe('EMPTY_VALUE_PLACEHOLDER', () => {
  it('should be a double hyphen', () => {
    expect(EMPTY_VALUE_PLACEHOLDER).toBe('--')
  })
})

describe('formatScoreValue uses consistent placeholder', () => {
  it('returns EMPTY_VALUE_PLACEHOLDER for null', () => {
    expect(formatScoreValue('cadd', null)).toBe(EMPTY_VALUE_PLACEHOLDER)
  })

  it('returns EMPTY_VALUE_PLACEHOLDER for undefined', () => {
    expect(formatScoreValue('cadd', undefined as unknown as null)).toBe(EMPTY_VALUE_PLACEHOLDER)
  })

  it('returns formatted value for non-null', () => {
    expect(formatScoreValue('cadd', 25.3)).toBe('25.3')
  })
})

describe('useTableFormatters uses consistent placeholder', () => {
  it('formatScientific returns placeholder for null', () => {
    expect(formatScientific(null)).toBe(EMPTY_VALUE_PLACEHOLDER)
  })

  it('formatCaddScore returns placeholder for null', () => {
    expect(formatCaddScore(null)).toBe(EMPTY_VALUE_PLACEHOLDER)
  })

  it('formatScore returns placeholder for null', () => {
    expect(formatScore(null)).toBe(EMPTY_VALUE_PLACEHOLDER)
  })

  it('formatScientific returns value for non-null', () => {
    expect(formatScientific(0.05)).toBe('0.0500')
  })

  it('formatCaddScore returns value for non-null', () => {
    expect(formatCaddScore(25.3)).toBe('25.3')
  })
})
