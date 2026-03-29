import { describe, it, expect } from 'vitest'
import {
  DEFAULT_INFO_FIELD_MAPPINGS,
  applyInfoFieldRegistry,
  getFieldColumnMapping
} from '../../../../src/main/import/vcf/info-field-registry'
import type { AnnotationResult } from '../../../../src/main/import/vcf/types'

describe('info-field-registry', () => {
  it('has default mappings for gnomad_af, cadd, clinvar', () => {
    const columns = DEFAULT_INFO_FIELD_MAPPINGS.map((m) => m.column)
    expect(columns).toContain('gnomad_af')
    expect(columns).toContain('cadd')
    expect(columns).toContain('clinvar')
  })

  it('maps gnomADe_AF to gnomad_af', () => {
    const info = new Map([['gnomADe_AF', '0.001']])
    const annotation: AnnotationResult = {
      geneSymbol: null,
      consequence: null,
      impact: null,
      transcript: null,
      cdna: null,
      aaChange: null,
      gnomadAf: null,
      cadd: null,
      clinvar: null,
      transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.mappedValues.get('gnomad_af')).toBeCloseTo(0.001, 6)
  })

  it('maps CLINVAR_CLNSIG to clinvar', () => {
    const info = new Map([['CLINVAR_CLNSIG', 'Pathogenic']])
    const annotation: AnnotationResult = {
      geneSymbol: null,
      consequence: null,
      impact: null,
      transcript: null,
      cdna: null,
      aaChange: null,
      gnomadAf: null,
      cadd: null,
      clinvar: null,
      transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.mappedValues.get('clinvar')).toBe('Pathogenic')
  })

  it('maps dbNSFP_CADD_phred to cadd', () => {
    const info = new Map([['dbNSFP_CADD_phred', '26.5']])
    const annotation: AnnotationResult = {
      geneSymbol: null,
      consequence: null,
      impact: null,
      transcript: null,
      cdna: null,
      aaChange: null,
      gnomadAf: null,
      cadd: null,
      clinvar: null,
      transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.mappedValues.get('cadd')).toBeCloseTo(26.5, 1)
  })

  it('annotation values take priority over INFO field values', () => {
    const info = new Map([['gnomADe_AF', '0.5']])
    const annotation: AnnotationResult = {
      geneSymbol: null,
      consequence: null,
      impact: null,
      transcript: null,
      cdna: null,
      aaChange: null,
      gnomadAf: 0.001, // CSQ already provided a value
      cadd: null,
      clinvar: null,
      transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    // CSQ value (0.001) should take priority — mapped value should not override
    expect(result.mappedValues.has('gnomad_af')).toBe(false)
  })

  it('unmapped INFO fields go to info_json', () => {
    const info = new Map([
      ['gnomADe_AF', '0.001'], // mapped
      ['SOME_CUSTOM', 'value1'], // unmapped
      ['ANOTHER_FIELD', 'value2'] // unmapped
    ])
    const annotation: AnnotationResult = {
      geneSymbol: null,
      consequence: null,
      impact: null,
      transcript: null,
      cdna: null,
      aaChange: null,
      gnomadAf: null,
      cadd: null,
      clinvar: null,
      transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.infoJson).not.toBeNull()
    expect(result.infoJson!['SOME_CUSTOM']).toBe('value1')
    expect(result.infoJson!['ANOTHER_FIELD']).toBe('value2')
    expect(result.infoJson!['gnomADe_AF']).toBeUndefined() // mapped, not in json
  })

  it('returns null info_json when all fields are mapped', () => {
    const info = new Map([['gnomADe_AF', '0.001']])
    const annotation: AnnotationResult = {
      geneSymbol: null,
      consequence: null,
      impact: null,
      transcript: null,
      cdna: null,
      aaChange: null,
      gnomadAf: null,
      cadd: null,
      clinvar: null,
      transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.infoJson).toBeNull()
  })

  it('skips CSQ and ANN fields from info_json', () => {
    const info = new Map([
      ['CSQ', 'huge|annotation|string'],
      ['ANN', 'another|annotation'],
      ['CUSTOM', 'keep']
    ])
    const annotation: AnnotationResult = {
      geneSymbol: null,
      consequence: null,
      impact: null,
      transcript: null,
      cdna: null,
      aaChange: null,
      gnomadAf: null,
      cadd: null,
      clinvar: null,
      transcripts: []
    }

    const result = applyInfoFieldRegistry(info, DEFAULT_INFO_FIELD_MAPPINGS, annotation)

    expect(result.infoJson!['CSQ']).toBeUndefined()
    expect(result.infoJson!['ANN']).toBeUndefined()
    expect(result.infoJson!['CUSTOM']).toBe('keep')
  })

  it('getFieldColumnMapping returns preview-friendly mapping info', () => {
    const infoDefs = new Map([
      [
        'gnomADe_AF',
        {
          id: 'gnomADe_AF',
          number: 'A',
          type: 'Float' as const,
          description: 'gnomAD exome AF'
        }
      ],
      [
        'CUSTOM',
        { id: 'CUSTOM', number: '1', type: 'String' as const, description: 'Custom field' }
      ]
    ])

    const mappings = getFieldColumnMapping(infoDefs, DEFAULT_INFO_FIELD_MAPPINGS)

    const gnomad = mappings.find((m) => m.id === 'gnomADe_AF')
    expect(gnomad?.mapsToColumn).toBe('gnomad_af')

    const custom = mappings.find((m) => m.id === 'CUSTOM')
    expect(custom?.mapsToColumn).toBeNull()
  })
})
