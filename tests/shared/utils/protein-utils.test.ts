import { describe, it, expect } from 'vitest'
import {
  parseProteinPosition,
  getConsequenceCategory,
  getConsequenceColor,
  CONSEQUENCE_COLORS,
  DOMAIN_TYPE_COLORS
} from '../../../src/shared/utils/protein-utils'
import type { ConsequenceCategory } from '../../../src/shared/types/protein'

describe('parseProteinPosition', () => {
  describe('three-letter amino acid notation', () => {
    it('parses standard missense (p.Ala123Val)', () => {
      expect(parseProteinPosition('p.Ala123Val')).toBe(123)
    })

    it('parses stop gained (p.Gln56Ter)', () => {
      expect(parseProteinPosition('p.Gln56Ter')).toBe(56)
    })

    it('parses frameshift (p.Gly12fs*17)', () => {
      expect(parseProteinPosition('p.Gly12fs*17')).toBe(12)
    })

    it('parses Ter/stop extension (p.Ter315ext*)', () => {
      expect(parseProteinPosition('p.Ter315ext*')).toBe(315)
    })
  })

  describe('single-letter amino acid notation', () => {
    it('parses single-letter missense (p.R248W)', () => {
      expect(parseProteinPosition('p.R248W')).toBe(248)
    })

    it('parses single-letter stop (p.R196*)', () => {
      expect(parseProteinPosition('p.R196*')).toBe(196)
    })

    it('parses single-letter with large position (p.K1234E)', () => {
      expect(parseProteinPosition('p.K1234E')).toBe(1234)
    })
  })

  describe('null / empty / unparseable inputs', () => {
    it('returns null for null input', () => {
      expect(parseProteinPosition(null)).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(parseProteinPosition('')).toBeNull()
    })

    it('returns null for p.? (unknown)', () => {
      expect(parseProteinPosition('p.?')).toBeNull()
    })

    it('returns null for coding DNA notation (c.368C>T)', () => {
      expect(parseProteinPosition('c.368C>T')).toBeNull()
    })

    it('returns null for plain gene name string', () => {
      expect(parseProteinPosition('BRCA1')).toBeNull()
    })
  })
})

describe('getConsequenceCategory', () => {
  it('maps missense_variant to missense', () => {
    expect(getConsequenceCategory('missense_variant')).toBe('missense')
  })

  it('maps stop_gained to truncating', () => {
    expect(getConsequenceCategory('stop_gained')).toBe('truncating')
  })

  it('maps frameshift_variant to truncating', () => {
    expect(getConsequenceCategory('frameshift_variant')).toBe('truncating')
  })

  it('maps stop_lost to truncating', () => {
    expect(getConsequenceCategory('stop_lost')).toBe('truncating')
  })

  it('maps start_lost to truncating', () => {
    expect(getConsequenceCategory('start_lost')).toBe('truncating')
  })

  it('maps inframe_deletion to inframe', () => {
    expect(getConsequenceCategory('inframe_deletion')).toBe('inframe')
  })

  it('maps inframe_insertion to inframe', () => {
    expect(getConsequenceCategory('inframe_insertion')).toBe('inframe')
  })

  it('maps splice_donor_variant to splice', () => {
    expect(getConsequenceCategory('splice_donor_variant')).toBe('splice')
  })

  it('maps splice_acceptor_variant to splice', () => {
    expect(getConsequenceCategory('splice_acceptor_variant')).toBe('splice')
  })

  it('maps splice_region_variant to splice', () => {
    expect(getConsequenceCategory('splice_region_variant')).toBe('splice')
  })

  it('maps synonymous_variant to synonymous', () => {
    expect(getConsequenceCategory('synonymous_variant')).toBe('synonymous')
  })

  it('maps unknown consequence to other', () => {
    expect(getConsequenceCategory('intergenic_variant')).toBe('other')
  })

  it('maps empty string to other', () => {
    expect(getConsequenceCategory('')).toBe('other')
  })

  it('maps unrecognized term to other', () => {
    expect(getConsequenceCategory('some_new_term')).toBe('other')
  })
})

describe('getConsequenceColor', () => {
  it('returns green (#008000) for missense_variant', () => {
    expect(getConsequenceColor('missense_variant')).toBe('#008000')
  })

  it('returns black (#000000) for stop_gained', () => {
    expect(getConsequenceColor('stop_gained')).toBe('#000000')
  })

  it('returns black (#000000) for frameshift_variant', () => {
    expect(getConsequenceColor('frameshift_variant')).toBe('#000000')
  })

  it('returns brown (#8B4513) for inframe_deletion', () => {
    expect(getConsequenceColor('inframe_deletion')).toBe('#8B4513')
  })

  it('returns orange (#FF8C00) for splice_donor_variant', () => {
    expect(getConsequenceColor('splice_donor_variant')).toBe('#FF8C00')
  })

  it('returns grey (#808080) for synonymous_variant', () => {
    expect(getConsequenceColor('synonymous_variant')).toBe('#808080')
  })

  it('returns silver (#C0C0C0) for unknown consequence', () => {
    expect(getConsequenceColor('unknown_variant')).toBe('#C0C0C0')
  })
})

describe('CONSEQUENCE_COLORS', () => {
  const expectedCategories: ConsequenceCategory[] = [
    'missense',
    'truncating',
    'inframe',
    'splice',
    'synonymous',
    'other'
  ]

  it('has all 6 consequence categories', () => {
    expect(Object.keys(CONSEQUENCE_COLORS)).toHaveLength(6)
  })

  it.each(expectedCategories)('has a color for category "%s"', (category) => {
    expect(CONSEQUENCE_COLORS[category]).toBeDefined()
    expect(CONSEQUENCE_COLORS[category]).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

describe('DOMAIN_TYPE_COLORS', () => {
  const commonDomainTypes = [
    'domain',
    'region',
    'motif',
    'transmembrane',
    'signal',
    'propeptide',
    'chain',
    'repeat',
    'zinc finger',
    'coiled coil'
  ]

  it('has colors for all common domain types', () => {
    expect(Object.keys(DOMAIN_TYPE_COLORS).length).toBeGreaterThanOrEqual(commonDomainTypes.length)
  })

  it.each(commonDomainTypes)('has a valid hex color for domain type "%s"', (type) => {
    expect(DOMAIN_TYPE_COLORS[type]).toBeDefined()
    expect(DOMAIN_TYPE_COLORS[type]).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})
