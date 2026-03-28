import { describe, it, expect } from 'vitest'
import { isInPAR, isSexChromosome } from '../../src/shared/utils/par-regions'

describe('isInPAR', () => {
  describe('GRCh38', () => {
    it('returns true for chrX PAR1 start boundary', () => {
      expect(isInPAR('chrX', 10001, 'GRCh38')).toBe(true)
    })
    it('returns true for X PAR1 without chr prefix', () => {
      expect(isInPAR('X', 10001, 'GRCh38')).toBe(true)
    })
    it('returns true for chrX PAR2', () => {
      expect(isInPAR('chrX', 155_800_000, 'GRCh38')).toBe(true)
    })
    it('returns false for chrX non-PAR region', () => {
      expect(isInPAR('chrX', 5_000_000, 'GRCh38')).toBe(false)
    })
    it('returns true for chrY PAR1', () => {
      expect(isInPAR('chrY', 100_000, 'GRCh38')).toBe(true)
    })
    it('returns false for autosome', () => {
      expect(isInPAR('chr1', 100_000, 'GRCh38')).toBe(false)
    })
    it('returns false for position just outside PAR1', () => {
      expect(isInPAR('chrX', 2_781_480, 'GRCh38')).toBe(false)
    })
  })

  describe('GRCh37', () => {
    it('returns true for chrX PAR1', () => {
      expect(isInPAR('X', 60001, 'GRCh37')).toBe(true)
    })
    it('returns false for chrX non-PAR', () => {
      expect(isInPAR('X', 3_000_000, 'GRCh37')).toBe(false)
    })
  })

  it('returns false for unknown build', () => {
    expect(isInPAR('chrX', 10001, 'hg19')).toBe(false)
  })
})

describe('isSexChromosome', () => {
  it('returns true for X', () => {
    expect(isSexChromosome('X')).toBe(true)
    expect(isSexChromosome('chrX')).toBe(true)
  })
  it('returns true for Y', () => {
    expect(isSexChromosome('Y')).toBe(true)
    expect(isSexChromosome('chrY')).toBe(true)
  })
  it('returns false for autosomes', () => {
    expect(isSexChromosome('1')).toBe(false)
    expect(isSexChromosome('chr22')).toBe(false)
  })
})
