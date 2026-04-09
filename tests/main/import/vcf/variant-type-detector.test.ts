import { describe, it, expect } from 'vitest'
import { detectVariantType } from '../../../../src/main/import/vcf/variant-type-detector'

describe('detectVariantType', () => {
  it('detects SNV from single-base REF/ALT', () => {
    expect(detectVariantType('A', 'T', new Map(), null)).toBe('snv')
  })

  it('detects indel from length difference', () => {
    expect(detectVariantType('AT', 'A', new Map(), null)).toBe('indel')
    expect(detectVariantType('A', 'ATG', new Map(), null)).toBe('indel')
  })

  it('detects SV from <DEL> symbolic ALT', () => {
    expect(detectVariantType('N', '<DEL>', new Map([['SVTYPE', 'DEL']]), null)).toBe('sv')
  })

  it('detects SV from <INS>', () => {
    expect(detectVariantType('N', '<INS>', new Map([['SVTYPE', 'INS']]), null)).toBe('sv')
  })

  it('detects SV from <INV>', () => {
    expect(detectVariantType('N', '<INV>', new Map([['SVTYPE', 'INV']]), null)).toBe('sv')
  })

  it('detects SV from breakend notation', () => {
    expect(detectVariantType('N', ']chr2:3000000]N', new Map([['SVTYPE', 'BND']]), null)).toBe('sv')
  })

  it('detects CNV from <DEL> when caller is Spectre', () => {
    expect(detectVariantType('N', '<DEL>', new Map([['SVTYPE', 'DEL']]), 'Spectre')).toBe('cnv')
  })

  it('detects CNV from <DUP> when caller is Spectre', () => {
    expect(detectVariantType('N', '<DUP>', new Map([['SVTYPE', 'DUP']]), 'Spectre')).toBe('cnv')
  })

  it('detects CNV from <CNV> symbolic ALT', () => {
    expect(detectVariantType('N', '<CNV>', new Map([['SVTYPE', 'CNV']]), null)).toBe('cnv')
  })

  it('detects STR from <STR*> symbolic ALT', () => {
    expect(detectVariantType('C', '<STR24>', new Map([['SVTYPE', 'DUP']]), null)).toBe('str')
  })

  it('detects STR from SVTYPE=STR', () => {
    expect(detectVariantType('N', '<DUP>', new Map([['SVTYPE', 'STR']]), null)).toBe('str')
  })
})
