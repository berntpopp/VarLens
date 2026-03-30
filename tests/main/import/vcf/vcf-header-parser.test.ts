import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  parseVcfHeader,
  parseVcfHeaderFromLines
} from '../../../../src/main/import/vcf/vcf-header-parser'

const SYNTHETIC_VCF = resolve(__dirname, '../../../test-data/vcf/synthetic-unit-test.vcf')

describe('vcf-header-parser', () => {
  describe('parseVcfHeaderFromLines', () => {
    const headerLines = [
      '##fileformat=VCFv4.2',
      '##FILTER=<ID=PASS,Description="All filters passed">',
      '##FILTER=<ID=LowQual,Description="Low quality variant">',
      '##INFO=<ID=CSQ,Number=.,Type=String,Description="Consequence annotations from Ensembl VEP. Format: Allele|Consequence|IMPACT|SYMBOL|Gene|Feature_type|Feature|BIOTYPE|EXON|INTRON|HGVSc|HGVSp|cDNA_position|CDS_position|Protein_position|Amino_acids|Codons|CANONICAL|MANE_SELECT|gnomADe_AF|CADD_PHRED|ClinVar_CLNSIG|SIFT|PolyPhen">',
      '##INFO=<ID=ANN,Number=.,Type=String,Description="Functional annotations: \'Allele | Annotation | Annotation_Impact | Gene_Name | Gene_ID | Feature_Type | Feature_ID | Transcript_BioType | Rank | HGVS.c | HGVS.p | cDNA.pos / cDNA.length | CDS.pos / CDS.length | AA.pos / AA.length | Distance | ERRORS / WARNINGS / INFO\'">',
      '##INFO=<ID=CLINVAR_CLNSIG,Number=.,Type=String,Description="ClinVar clinical significance">',
      '##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype">',
      '##FORMAT=<ID=GQ,Number=1,Type=Integer,Description="Genotype Quality">',
      '##FORMAT=<ID=DP,Number=1,Type=Integer,Description="Read Depth">',
      '##FORMAT=<ID=AD,Number=R,Type=Integer,Description="Allelic depths for the ref and alt alleles">',
      '##contig=<ID=chr1,length=248956422>',
      '##contig=<ID=chr22,length=50818468>',
      '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tHG005\tHG006\tHG007'
    ]

    it('parses fileformat version', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.fileformat).toBe('VCFv4.2')
    })

    it('extracts sample names from #CHROM line', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.samples).toEqual(['HG005', 'HG006', 'HG007'])
    })

    it('parses INFO field definitions', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.infoDefs.size).toBeGreaterThanOrEqual(3)

      const csq = header.infoDefs.get('CSQ')
      expect(csq).toBeDefined()
      expect(csq!.number).toBe('.')
      expect(csq!.type).toBe('String')

      const clinvar = header.infoDefs.get('CLINVAR_CLNSIG')
      expect(clinvar).toBeDefined()
      expect(clinvar!.type).toBe('String')
    })

    it('parses FORMAT field definitions', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.formatDefs.size).toBe(4)

      const gt = header.formatDefs.get('GT')
      expect(gt).toBeDefined()
      expect(gt!.type).toBe('String')

      const ad = header.formatDefs.get('AD')
      expect(ad).toBeDefined()
      expect(ad!.number).toBe('R')
    })

    it('parses contig definitions', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.contigs.size).toBe(2)
      expect(header.contigs.get('chr1')?.length).toBe(248956422)
    })

    it('detects CSQ annotation type when CSQ INFO field has Format in description', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      // Has both CSQ and ANN — CSQ takes priority
      expect(header.annotationType).toBe('csq')
    })

    it('extracts CSQ subfield names from description', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.csqFields).not.toBeNull()
      expect(header.csqFields).toContain('Allele')
      expect(header.csqFields).toContain('Consequence')
      expect(header.csqFields).toContain('IMPACT')
      expect(header.csqFields).toContain('SYMBOL')
      expect(header.csqFields).toContain('CANONICAL')
      expect(header.csqFields).toContain('MANE_SELECT')
      expect(header.csqFields).toContain('gnomADe_AF')
    })

    it('detects ANN when only ANN is present', () => {
      const annOnlyLines = headerLines.filter((l) => !l.includes('ID=CSQ'))
      const header = parseVcfHeaderFromLines(annOnlyLines)
      expect(header.annotationType).toBe('ann')
      expect(header.csqFields).toBeNull()
    })

    it('detects none when neither CSQ nor ANN present', () => {
      const noAnnotLines = headerLines.filter((l) => !l.includes('ID=CSQ') && !l.includes('ID=ANN'))
      const header = parseVcfHeaderFromLines(noAnnotLines)
      expect(header.annotationType).toBe('none')
    })

    it('detects genome build from contig lengths', () => {
      const header = parseVcfHeaderFromLines(headerLines)
      expect(header.genomeBuild).toBe('GRCh38')
    })

    it('handles VCF without samples (sites-only)', () => {
      const sitesOnly = ['##fileformat=VCFv4.2', '#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO']
      const header = parseVcfHeaderFromLines(sitesOnly)
      expect(header.samples).toEqual([])
      expect(header.annotationType).toBe('none')
    })
  })

  describe('parseVcfHeader (stream-based)', () => {
    it('parses the synthetic test VCF file', async () => {
      const result = await parseVcfHeader(SYNTHETIC_VCF)

      expect(result.header.fileformat).toBe('VCFv4.2')
      expect(result.header.samples).toEqual(['HG005', 'HG006', 'HG007'])
      expect(result.header.annotationType).toBe('csq')
      expect(result.header.csqFields).toContain('Allele')
      expect(result.header.genomeBuild).toBe('GRCh38')
      expect(result.firstDataLine).toBeTruthy()
      expect(result.firstDataLine).toContain('chr22')
    })
  })
})
