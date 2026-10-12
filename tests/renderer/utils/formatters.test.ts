import { describe, it, expect } from 'vitest'
import { formatHgvs, variantHeading } from '../../../src/renderer/src/utils/formatters'
import {
  EMPTY_VALUE_PLACEHOLDER,
  NO_GENE_LABEL
} from '../../../src/renderer/src/config/displayConfig'
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

describe('formatHgvs', () => {
  it('leaves a full VEP value alone instead of prefixing the transcript again', () => {
    expect(formatHgvs('ENST00000357654.9:c.68_69del', 'ENST00000357654')).toBe(
      'ENST00000357654.9:c.68_69del'
    )
  })

  it('prefixes the transcript onto a bare c. value', () => {
    expect(formatHgvs('c.1A>G', 'NM_1.1')).toBe('NM_1.1:c.1A>G')
  })

  it('decodes the VEP %3D escape and returns null for empty values', () => {
    expect(formatHgvs('ENSP1:p.Val74%3D')).toBe('ENSP1:p.Val74=')
    expect(formatHgvs('')).toBeNull()
    expect(formatHgvs(null, 'NM_1.1')).toBeNull()
  })
})

describe('variantHeading', () => {
  it.each([
    [{ gene_symbol: 'LMNA', aa_change: 'p.Arg453Trp', cdna: 'c.1357C>T' }, 'LMNA · p.Arg453Trp'],
    [
      { gene_symbol: 'LMNA', aa_change: null, cdna: 'ENST1.7:c.1357C>T' },
      'LMNA · ENST1.7:c.1357C>T'
    ],
    [{ gene_symbol: null, _str_repeat_id: 'FMR1_CGG' }, 'FMR1_CGG'],
    [{ gene_symbol: null }, NO_GENE_LABEL],
    [null, NO_GENE_LABEL]
  ])('%o → %s', (variant, expected) => {
    expect(variantHeading(variant)).toBe(expected)
  })
})
