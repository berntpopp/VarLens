import { describe, it, expect } from 'vitest'
import { mapVcfRecord } from '../../../../src/main/import/vcf/VcfMapper'
import type { VcfRawRecord, VcfHeader } from '../../../../src/main/import/vcf/types'
import { DEFAULT_INFO_FIELD_MAPPINGS } from '../../../../src/main/import/vcf/info-field-registry'

function makeHeader(): VcfHeader {
  return {
    fileformat: 'VCFv4.2',
    samples: ['HG005', 'HG006', 'HG007'],
    infoDefs: new Map([
      [
        'CSQ',
        {
          id: 'CSQ',
          number: '.',
          type: 'String' as const,
          description:
            'VEP Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature_type|Feature|BIOTYPE|EXON|INTRON|HGVSc|HGVSp|cDNA_position|CDS_position|Protein_position|Amino_acids|Codons|CANONICAL|MANE_SELECT|gnomADe_AF|CADD_PHRED|ClinVar_CLNSIG|SIFT|PolyPhen'
        }
      ],
      [
        'CLINVAR_CLNSIG',
        { id: 'CLINVAR_CLNSIG', number: '.', type: 'String' as const, description: 'ClinVar' }
      ]
    ]),
    formatDefs: new Map([
      ['GT', { id: 'GT', number: '1', type: 'String' as const, description: 'Genotype' }],
      ['GQ', { id: 'GQ', number: '1', type: 'Integer' as const, description: 'Genotype Quality' }],
      ['DP', { id: 'DP', number: '1', type: 'Integer' as const, description: 'Read Depth' }],
      ['AD', { id: 'AD', number: 'R', type: 'Integer' as const, description: 'Allelic depths' }]
    ]),
    contigs: new Map(),
    annotationType: 'csq',
    csqFields: [
      'Allele',
      'Consequence',
      'IMPACT',
      'SYMBOL',
      'Gene',
      'Feature_type',
      'Feature',
      'BIOTYPE',
      'EXON',
      'INTRON',
      'HGVSc',
      'HGVSp',
      'cDNA_position',
      'CDS_position',
      'Protein_position',
      'Amino_acids',
      'Codons',
      'CANONICAL',
      'MANE_SELECT',
      'gnomADe_AF',
      'CADD_PHRED',
      'ClinVar_CLNSIG',
      'SIFT',
      'PolyPhen'
    ],
    genomeBuild: 'GRCh38',
    rawHeaderLines: []
  }
}

describe('VcfMapper', () => {
  const header = makeHeader()

  it('maps a single-allelic CSQ-annotated variant', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 20000100,
      id: 'rs123456',
      ref: 'A',
      alt: ['G'],
      qual: 99,
      filter: 'PASS',
      info: new Map([
        [
          'CSQ',
          'G|missense_variant|MODERATE|COMT|ENSG00000093010|Transcript|ENST00000361682|protein_coding|3/6|.|c.322A>G|p.Met108Val|472|322|108|M/V|Atg/Gtg|YES|NM_000754.4||25.3|Uncertain_significance|deleterious(0.01)|probably_damaging(0.95)'
        ]
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['0/1', '99', '45', '22,23']],
        ['HG006', ['0/0', '99', '40', '40,0']],
        ['HG007', ['0/0', '99', '38', '38,0']]
      ])
    }

    const results = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(1)
    const v = results[0]

    expect(v.chr).toBe('chr22')
    expect(v.pos).toBe(20000100)
    expect(v.ref).toBe('A')
    expect(v.alt).toBe('G')
    expect(v.gene_symbol).toBe('COMT')
    expect(v.consequence).toBe('MODERATE')
    expect(v.func).toBe('missense_variant')
    expect(v.transcript).toBe('ENST00000361682')
    expect(v.cdna).toBe('c.322A>G')
    expect(v.aa_change).toBe('p.Met108Val')
    expect(v.cadd).toBeCloseTo(25.3, 1)
    expect(v.clinvar).toBe('Uncertain_significance')
    expect(v.gt_num).toBe('0/1')
    expect(v.gq).toBe(99)
    expect(v.dp).toBe(45)
    expect(v.ad_ref).toBe(22)
    expect(v.ad_alt).toBe(23)
    expect(v.ab).toBeCloseTo(23 / 45, 4)
    expect(v.qual).toBe(99)
    expect(v.filter).toBe('PASS')
    expect(v.source_format).toBe('vcf')
    expect(v._transcripts).toBeDefined()
    expect(v._transcripts!.length).toBeGreaterThanOrEqual(1)
  })

  it('skips ref-homozygous variants for the selected sample', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 100,
      id: null,
      ref: 'A',
      alt: ['G'],
      qual: 99,
      filter: 'PASS',
      info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['HG005', ['0/0', '99', '40', '40,0']]])
    }

    const results = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(0)
  })

  it('skips no-call variants (./.)', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 100,
      id: null,
      ref: 'A',
      alt: ['G'],
      qual: 99,
      filter: 'PASS',
      info: new Map(),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['HG005', ['./.', '.', '.', '.']]])
    }

    const results = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(0)
  })

  it('splits multi-allelic into two mapped variants', () => {
    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 20002000,
      id: 'rs456789',
      ref: 'A',
      alt: ['G', 'T'],
      qual: 95,
      filter: 'PASS',
      info: new Map([
        [
          'CSQ',
          'G|missense_variant|MODERATE|COMT|E1|Transcript|T1|protein_coding|||c.1A>G|p.I114V|||||YES|NM_000754.4|0.08|18.5||tolerated(0.3)|benign(0.1),T|missense_variant|MODERATE|COMT|E1|Transcript|T1|protein_coding|||c.1A>T|p.I114F|||||YES|NM_000754.4|0.02|23.7||deleterious(0.02)|possibly_damaging(0.8)'
        ]
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([
        ['HG005', ['0/1', '95', '50', '25,25,0']],
        ['HG006', ['0/2', '90', '48', '24,0,24']]
      ])
    }

    // HG005 has 0/1: only ALT=G is relevant
    const resultsHG005 = mapVcfRecord(record, header, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)
    expect(resultsHG005).toHaveLength(1)
    expect(resultsHG005[0].alt).toBe('G')

    // HG006 has 0/2: only ALT=T is relevant
    const resultsHG006 = mapVcfRecord(record, header, 'HG006', DEFAULT_INFO_FIELD_MAPPINGS)
    expect(resultsHG006).toHaveLength(1)
    expect(resultsHG006[0].alt).toBe('T')
  })

  it('maps ANN-annotated variant with standalone INFO fields', () => {
    const annHeader: VcfHeader = {
      ...header,
      annotationType: 'ann',
      csqFields: null
    }

    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 20004000,
      id: 'rs567890',
      ref: 'T',
      alt: ['C'],
      qual: 88,
      filter: 'PASS',
      info: new Map([
        [
          'ANN',
          'C|missense_variant|MODERATE|SNAP29|ENSG00000099940|transcript|ENST00000215730.5|protein_coding|4/7|c.310T>C|p.Ser104Pro|310/1089|310/828|104/275||'
        ],
        ['CLINVAR_CLNSIG', 'Likely_pathogenic'],
        ['dbNSFP_CADD_phred', '26.5'],
        ['dbNSFP_REVEL_score', '0.82']
      ]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['HG005', ['0/1', '88', '44', '22,22']]])
    }

    const results = mapVcfRecord(record, annHeader, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(1)
    const v = results[0]
    expect(v.gene_symbol).toBe('SNAP29')
    expect(v.clinvar).toBe('Likely_pathogenic')
    expect(v.cadd).toBeCloseTo(26.5, 1)
    expect(v.info_json).not.toBeNull()
    const infoJson = JSON.parse(v.info_json!)
    expect(infoJson['dbNSFP_REVEL_score']).toBe('0.82')
  })

  it('handles unannotated VCF with only core fields', () => {
    const unannotatedHeader: VcfHeader = {
      ...header,
      annotationType: 'none',
      csqFields: null
    }

    const record: VcfRawRecord = {
      chrom: 'chr22',
      pos: 100,
      id: null,
      ref: 'A',
      alt: ['G'],
      qual: 50,
      filter: 'PASS',
      info: new Map([['AF', '0.1']]),
      format: ['GT', 'GQ', 'DP', 'AD'],
      samples: new Map([['HG005', ['0/1', '50', '20', '10,10']]])
    }

    const results = mapVcfRecord(record, unannotatedHeader, 'HG005', DEFAULT_INFO_FIELD_MAPPINGS)

    expect(results).toHaveLength(1)
    const v = results[0]
    expect(v.chr).toBe('chr22')
    expect(v.gt_num).toBe('0/1')
    expect(v.gene_symbol).toBeNull()
    expect(v.gnomad_af).toBeCloseTo(0.1, 4) // mapped from AF via registry
  })
})
