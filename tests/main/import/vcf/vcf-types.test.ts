import { describe, it, expect } from 'vitest'
import type {
  VcfHeader,
  VcfRawRecord,
  GenotypeData,
  AnnotationResult,
  InfoFieldMapping,
  VcfMappedVariant,
  VcfPreviewResult,
  VcfImportOptions
} from '../../../../src/main/import/vcf/types'

describe('VCF types', () => {
  it('VcfHeader can be constructed with all required fields', () => {
    const header: VcfHeader = {
      fileformat: 'VCFv4.2',
      samples: ['HG005', 'HG006', 'HG007'],
      infoDefs: new Map([
        ['CSQ', { id: 'CSQ', number: '.', type: 'String', description: 'VEP annotations' }]
      ]),
      formatDefs: new Map([
        ['GT', { id: 'GT', number: '1', type: 'String', description: 'Genotype' }]
      ]),
      contigs: new Map([['chr1', { id: 'chr1', length: 248956422 }]]),
      annotationType: 'csq',
      csqFields: ['Allele', 'Consequence', 'IMPACT', 'SYMBOL'],
      genomeBuild: 'GRCh38',
      rawHeaderLines: ['##fileformat=VCFv4.2']
    }

    expect(header.samples).toHaveLength(3)
    expect(header.annotationType).toBe('csq')
    expect(header.csqFields).toHaveLength(4)
  })

  it('VcfRawRecord can represent a multi-allelic site', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 20000100,
      id: 'rs12345',
      ref: 'A',
      alt: ['G', 'T'],
      qual: 99.5,
      filter: 'PASS',
      info: new Map([
        ['CSQ', 'G|missense_variant|MODERATE|COMT'],
        ['DP', '100']
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['0/1', '99', '50', '25,25']],
        ['HG006', ['0/2', '85', '40', '20,0,20']]
      ])
    }

    expect(record.alt).toHaveLength(2)
    expect(record.samples.size).toBe(2)
    expect(record.samples.get('HG006')?.[0]).toBe('0/2')
  })

  it('GenotypeData computes allele balance', () => {
    const genotype: GenotypeData = {
      gt: '0/1',
      gq: 99,
      dp: 50,
      adRef: 25,
      adAlt: 25,
      ab: 25 / (25 + 25)
    }

    expect(genotype.ab).toBeCloseTo(0.5)
    expect(genotype.gt).toBe('0/1')
  })

  it('AnnotationResult can hold multiple transcripts', () => {
    const result: AnnotationResult = {
      geneSymbol: 'COMT',
      consequence: 'missense_variant',
      impact: 'MODERATE',
      transcript: 'ENST00000361682',
      cdna: 'c.322A>G',
      aaChange: 'p.Met108Val',
      gnomadAf: 0.35,
      cadd: 25.3,
      clinvar: 'Uncertain_significance',
      transcripts: [
        {
          transcript_id: 'ENST00000361682',
          gene_symbol: 'COMT',
          consequence: 'missense_variant',
          cdna: 'c.322A>G',
          aa_change: 'p.Met108Val',
          hpo_sim_score: null,
          moi: null,
          is_selected: 1
        },
        {
          transcript_id: 'ENST00000541484',
          gene_symbol: 'COMT',
          consequence: 'missense_variant',
          cdna: 'c.322A>G',
          aa_change: 'p.Met108Val',
          hpo_sim_score: null,
          moi: null,
          is_selected: 0
        }
      ]
    }

    expect(result.transcripts).toHaveLength(2)
    expect(result.transcripts[0].is_selected).toBe(1)
    expect(result.transcripts[1].is_selected).toBe(0)
  })

  it('InfoFieldMapping configures field resolution', () => {
    const mapping: InfoFieldMapping = {
      infoIds: ['gnomADe_AF', 'gnomADg_AF', 'gnomAD_AF', 'AF'],
      column: 'gnomad_af',
      type: 'float',
      csqField: 'gnomADe_AF',
      description: 'gnomAD population allele frequency'
    }

    expect(mapping.infoIds).toContain('gnomADe_AF')
    expect(mapping.type).toBe('float')
  })

  it('VcfMappedVariant includes all VCF-specific fields', () => {
    const variant: VcfMappedVariant = {
      chr: 'chr22',
      pos: 20000100,
      ref: 'A',
      alt: 'G',
      gene_symbol: 'COMT',
      omim_mim_number: null,
      consequence: 'MODERATE',
      gnomad_af: 0.35,
      cadd: 25.3,
      clinvar: 'Uncertain_significance',
      gt_num: '0/1',
      func: 'missense_variant',
      qual: 99,
      hpo_sim_score: null,
      transcript: 'ENST00000361682',
      cdna: 'c.322A>G',
      aa_change: 'p.Met108Val',
      hpo_match: null,
      moi: null,
      gq: 99,
      dp: 45,
      ad_ref: 22,
      ad_alt: 23,
      ab: 0.511,
      filter: 'PASS',
      info_json: null,
      source_format: 'vcf'
    }

    expect(variant.source_format).toBe('vcf')
    expect(variant.gq).toBe(99)
  })

  it('VcfPreviewResult provides import dialog metadata', () => {
    const preview: VcfPreviewResult = {
      fileformat: 'VCFv4.2',
      samples: ['HG005', 'HG006', 'HG007'],
      variantCountEstimate: 2000,
      annotationType: 'csq',
      detectedGenomeBuild: 'GRCh38',
      infoFields: [
        {
          id: 'CSQ',
          type: 'String',
          number: '.',
          description: 'VEP annotations',
          mapsToColumn: null
        }
      ]
    }

    expect(preview.samples).toHaveLength(3)
    expect(preview.annotationType).toBe('csq')
  })

  it('VcfImportOptions carries sample selection', () => {
    const options: VcfImportOptions = {
      selectedSamples: ['HG005', 'HG007'],
      genomeBuild: 'GRCh38',
      caseNames: new Map([
        ['HG005', 'Patient A'],
        ['HG007', 'Patient B']
      ])
    }

    expect(options.selectedSamples).toHaveLength(2)
    expect(options.caseNames?.get('HG005')).toBe('Patient A')
  })
})
