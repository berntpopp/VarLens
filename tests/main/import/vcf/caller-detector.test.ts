import { describe, it, expect } from 'vitest'
import { detectCaller } from '../../../../src/main/import/vcf/caller-detector'

describe('detectCaller', () => {
  it('detects Sniffles2 with version', () => {
    const result = detectCaller(['##source=Sniffles2_2.6.3'])
    expect(result.name).toBe('Sniffles2')
    expect(result.version).toBe('2.6.3')
    expect(result.defaultVariantType).toBe('sv')
  })

  it('detects Spectre', () => {
    const result = detectCaller(['##source=Spectre'])
    expect(result.name).toBe('Spectre')
    expect(result.defaultVariantType).toBe('cnv')
    expect(result.defaultFilters.passOnly).toBe(false)
  })

  it('detects Straglr', () => {
    const result = detectCaller(['##source=strglr_1.4.5'])
    expect(result.name).toBe('Straglr')
    expect(result.defaultVariantType).toBe('str')
  })

  it('detects Clair3 with quality default', () => {
    const result = detectCaller(['##source=Clair3'])
    expect(result.name).toBe('Clair3')
    expect(result.defaultFilters.passOnly).toBe(true)
    expect(result.defaultFilters.minQual).toBe(2)
  })

  it('detects DRAGEN', () => {
    const result = detectCaller(['##source=DRAGEN_CNV'])
    expect(result.name).toBe('DRAGEN')
  })

  it('returns unknown for unrecognized caller', () => {
    const result = detectCaller(['##source=UnknownTool'])
    expect(result.name).toBe('unknown')
    expect(result.defaultFilters.passOnly).toBe(false)
  })

  it('handles missing ##source line', () => {
    const result = detectCaller(['##fileformat=VCFv4.2', '##contig=<ID=chr1>'])
    expect(result.name).toBe('unknown')
  })

  it('detects caller from ##command line as fallback', () => {
    const result = detectCaller([
      '##fileformat=VCFv4.2',
      '##command="/opt/bin/sniffles --input sample.bam"'
    ])
    expect(result.name).toBe('Sniffles2')
  })
})
