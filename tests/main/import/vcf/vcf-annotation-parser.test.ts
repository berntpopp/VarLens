import { describe, it, expect } from 'vitest'
import { parseAnnotation } from '../../../../src/main/import/vcf/vcf-annotation-parser'
import type { VcfHeader } from '../../../../src/main/import/vcf/types'

function makeHeader(overrides: Partial<VcfHeader> = {}): VcfHeader {
  return {
    fileformat: 'VCFv4.2',
    samples: [],
    infoDefs: new Map(),
    formatDefs: new Map(),
    contigs: new Map(),
    annotationType: 'none',
    csqFields: null,
    genomeBuild: null,
    rawHeaderLines: [],
    ...overrides
  }
}

describe('vcf-annotation-parser', () => {
  describe('CSQ parsing', () => {
    const csqFields = [
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
    ]
    const header = makeHeader({ annotationType: 'csq', csqFields })

    it('extracts fields from a single CSQ transcript', () => {
      const info = new Map([
        [
          'CSQ',
          'T|synonymous_variant|LOW|COMT|ENSG00000093010|Transcript|ENST00000361682|protein_coding|2/6|.|ENST00000361682.4:c.186C>T|ENSP00000354346.4:p.Ala62=|336|186|62|A|gcC/gcT|YES|NM_000754.4|0.12|11.2||tolerated(0.8)|benign(0.05)'
        ]
      ])

      const result = parseAnnotation(info, header, 'T')

      expect(result.geneSymbol).toBe('COMT')
      expect(result.consequence).toBe('synonymous_variant')
      expect(result.impact).toBe('LOW')
      expect(result.transcript).toBe('ENST00000361682')
      expect(result.cdna).toBe('ENST00000361682.4:c.186C>T')
      expect(result.aaChange).toBe('ENSP00000354346.4:p.Ala62=')
      expect(result.gnomadAf).toBeCloseTo(0.12, 4)
      expect(result.cadd).toBeCloseTo(11.2, 1)
      expect(result.clinvar).toBeNull() // empty field
      expect(result.transcripts).toHaveLength(1)
      expect(result.transcripts[0].is_selected).toBe(1)
    })

    it('selects MANE Select transcript over others', () => {
      // First transcript is MANE_SELECT + CANONICAL, second is not
      const info = new Map([
        [
          'CSQ',
          'G|missense_variant|MODERATE|COMT|ENSG00000093010|Transcript|ENST00000361682|protein_coding|3/6|.|c.322A>G|p.Met108Val|472|322|108|M/V|Atg/Gtg|YES|NM_000754.4||25.3|Uncertain_significance|deleterious(0.01)|probably_damaging(0.95),G|missense_variant|MODERATE|COMT|ENSG00000093010|Transcript|ENST00000406888|protein_coding|4/7|.|c.472A>G|p.Met158Val|622|472|158|M/V|Atg/Gtg|||0.35|24.8|||'
        ]
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.transcripts).toHaveLength(2)
      // MANE_SELECT transcript should be selected
      expect(result.transcript).toBe('ENST00000361682')
      expect(result.transcripts[0].is_selected).toBe(1)
      expect(result.transcripts[1].is_selected).toBe(0)
    })

    it('filters annotations by allele', () => {
      // Two annotations: one for G, one for T. We want only G.
      const info = new Map([
        [
          'CSQ',
          'G|missense_variant|MODERATE|COMT|E1|Transcript|T1|protein_coding||||||||||||||||,T|stop_gained|HIGH|COMT|E1|Transcript|T2|protein_coding||||||||||||||||'
        ]
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.transcripts).toHaveLength(1)
      expect(result.geneSymbol).toBe('COMT')
    })

    it('handles empty CSQ value', () => {
      const info = new Map([['CSQ', '']])

      const result = parseAnnotation(info, header, 'G')

      expect(result.geneSymbol).toBeNull()
      expect(result.transcripts).toHaveLength(0)
    })

    it('selects HIGH impact over MODERATE when no MANE/canonical', () => {
      const info = new Map([
        [
          'CSQ',
          'G|missense_variant|MODERATE|GENE1|E1|Transcript|T1|protein_coding|||c.1A>G|p.X1Y||||||||||||||,G|stop_gained|HIGH|GENE1|E1|Transcript|T2|protein_coding|||c.2A>G|p.X2*||||||||||||||'
        ]
      ])

      const result = parseAnnotation(info, header, 'G')
      expect(result.transcript).toBe('T2')
      expect(result.impact).toBe('HIGH')
    })

    it('matches VEP insertion and deletion allele notation', () => {
      const deletion = parseAnnotation(
        new Map([
          [
            'CSQ',
            '-|frameshift_variant|HIGH|GENE1|E1|Transcript|T1|protein_coding|||c.1del|p.?||||||||||||||'
          ]
        ]),
        header,
        'A',
        'AT'
      )
      const insertion = parseAnnotation(
        new Map([
          [
            'CSQ',
            'TG|inframe_insertion|MODERATE|GENE2|E2|Transcript|T2|protein_coding|||c.2insTG|p.?||||||||||||||'
          ]
        ]),
        header,
        'ATG',
        'A'
      )

      expect(deletion.geneSymbol).toBe('GENE1')
      expect(deletion.impact).toBe('HIGH')
      expect(insertion.geneSymbol).toBe('GENE2')
      expect(insertion.impact).toBe('MODERATE')
    })
  })

  describe('ANN parsing', () => {
    const header = makeHeader({ annotationType: 'ann' })

    it('extracts fields from ANN annotation', () => {
      const info = new Map([
        [
          'ANN',
          'C|missense_variant|MODERATE|SNAP29|ENSG00000099940|transcript|ENST00000215730.5|protein_coding|4/7|c.310T>C|p.Ser104Pro|310/1089|310/828|104/275||'
        ]
      ])

      const result = parseAnnotation(info, header, 'C')

      expect(result.geneSymbol).toBe('SNAP29')
      expect(result.consequence).toBe('missense_variant')
      expect(result.impact).toBe('MODERATE')
      expect(result.transcript).toBe('ENST00000215730.5')
      expect(result.cdna).toBe('c.310T>C')
      expect(result.aaChange).toBe('p.Ser104Pro')
      expect(result.transcripts).toHaveLength(1)
    })

    it('handles multi-annotation ANN with allele filtering', () => {
      const info = new Map([
        [
          'ANN',
          'G|missense_variant|MODERATE|LZTR1|E1|transcript|T1|protein_coding|12/19|c.1360C>G|p.Leu454Val|1360/2622|1360/2466|454/821||,G|upstream_gene_variant|MODIFIER|SLC25A1|E2|transcript|T2|protein_coding|||||||1234||'
        ]
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.transcripts).toHaveLength(2)
      // MODERATE should be selected over MODIFIER
      expect(result.transcript).toBe('T1')
      expect(result.geneSymbol).toBe('LZTR1')
    })

    it('handles compound annotations (frameshift&splice_region)', () => {
      const info = new Map([
        [
          'ANN',
          'G|frameshift_variant&splice_region_variant|HIGH|LZTR1|E1|transcript|T1|protein_coding|8/19|c.720_721del|p.Ala241fs|720/2622|720/2466|241/821||'
        ]
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result.consequence).toBe('frameshift_variant&splice_region_variant')
      expect(result.impact).toBe('HIGH')
    })
  })

  describe('unannotated VCF', () => {
    const header = makeHeader({ annotationType: 'none' })

    it('returns all nulls for unannotated VCF', () => {
      const info = new Map([['AF', '0.5']])
      const result = parseAnnotation(info, header, 'G')

      expect(result.geneSymbol).toBeNull()
      expect(result.consequence).toBeNull()
      expect(result.transcripts).toHaveLength(0)
    })
  })
})
