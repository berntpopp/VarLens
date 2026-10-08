import { describe, it, expect } from 'vitest'
import {
  genotypeZygosity,
  gtToDosage,
  otherZygosityCount
} from '../../../src/shared/utils/genotype'

describe('gtToDosage', () => {
  it('returns 0 for homozygous reference 0/0', () => {
    expect(gtToDosage('0/0')).toBe(0)
  })

  it('returns 0 for phased homozygous reference 0|0', () => {
    expect(gtToDosage('0|0')).toBe(0)
  })

  it('returns 1 for heterozygous 0/1', () => {
    expect(gtToDosage('0/1')).toBe(1)
  })

  it('returns 1 for reversed heterozygous 1/0', () => {
    expect(gtToDosage('1/0')).toBe(1)
  })

  it('returns 1 for phased heterozygous 0|1', () => {
    expect(gtToDosage('0|1')).toBe(1)
  })

  it('returns 1 for phased reversed heterozygous 1|0', () => {
    expect(gtToDosage('1|0')).toBe(1)
  })

  it('returns 2 for homozygous alt 1/1', () => {
    expect(gtToDosage('1/1')).toBe(2)
  })

  it('returns 2 for phased homozygous alt 1|1', () => {
    expect(gtToDosage('1|1')).toBe(2)
  })

  it('returns null for missing ./.', () => {
    expect(gtToDosage('./.')).toBeNull()
  })

  it('returns null for phased missing .|.', () => {
    expect(gtToDosage('.|.')).toBeNull()
  })

  it('returns null for single missing .', () => {
    expect(gtToDosage('.')).toBeNull()
  })

  it('returns 1 for haploid alt 1', () => {
    expect(gtToDosage('1')).toBe(1)
  })

  it('returns 0 for haploid ref 0', () => {
    expect(gtToDosage('0')).toBe(0)
  })

  it('returns null for null input', () => {
    expect(gtToDosage(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(gtToDosage(undefined)).toBeNull()
  })

  it('handles multi-allelic 0/2 via fallback', () => {
    expect(gtToDosage('0/2')).toBe(1)
  })

  it('handles multi-allelic 2/2 via fallback', () => {
    expect(gtToDosage('2/2')).toBe(2)
  })

  it('handles partial missing 0/. as null', () => {
    expect(gtToDosage('0/.')).toBeNull()
  })

  // A split 1/2 site is stored as 1/. and ./1: one called copy of this allele.
  it.each(['1/.', './1', '1|.', '.|1'])('counts the called ALT allele of %s', (gt) => {
    expect(gtToDosage(gt)).toBe(1)
  })
})

describe('genotypeZygosity', () => {
  it.each(['0/1', '1/0', '0|1', '1|0', '1/.', './1', '1|.', '.|1'])('%s is het', (gt) => {
    expect(genotypeZygosity(gt)).toBe('het')
  })

  it.each(['1/1', '1|1'])('%s is hom', (gt) => {
    expect(genotypeZygosity(gt)).toBe('hom')
  })

  it('a haploid ALT call is hemizygous, not het or hom', () => {
    expect(genotypeZygosity('1')).toBe('hemi')
  })

  it.each(['0/0', '0', './.', '.', '0/.', '', 'het', null, undefined])(
    '%s has no ALT zygosity',
    (gt) => {
      expect(genotypeZygosity(gt)).toBeNull()
    }
  )
})

describe('otherZygosityCount', () => {
  it('is the carriers that are neither het nor hom', () => {
    expect(otherZygosityCount({ carrier_count: 4, het_count: 2, hom_count: 1 })).toBe(1)
    expect(otherZygosityCount({ carrier_count: 3, het_count: 2, hom_count: 1 })).toBe(0)
  })

  it('is never negative while a summary is being refreshed', () => {
    expect(otherZygosityCount({ carrier_count: 1, het_count: 2, hom_count: 0 })).toBe(0)
  })
})
