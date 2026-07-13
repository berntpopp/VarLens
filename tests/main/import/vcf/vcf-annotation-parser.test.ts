import { describe, it, expect } from 'vitest'
import {
  parseAnnotation,
  parseAnnotationsForAlleles
} from '../../../../src/main/import/vcf/vcf-annotation-parser'
import type { VcfHeader } from '../../../../src/main/import/vcf/types'
import {
  MAX_VCF_ANNOTATION_FIELDS,
  MAX_VCF_ANNOTATIONS,
  VcfResourceLimitError
} from '../../../../src/main/import/vcf/vcf-resource-limits'

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
      // Canonical model (issue C4/F-02): per-transcript `consequence` must be
      // the IMPACT level, and the new `func` column must carry the SO term —
      // the same split already used on the top-level `variants` row.
      expect(result.transcripts[0].consequence).toBe('LOW')
      expect(result.transcripts[0].func).toBe('synonymous_variant')
    })

    it('rejects a non-enum IMPACT while preserving its SO consequence', () => {
      const info = new Map([
        [
          'CSQ',
          'T|synonymous_variant|SEVERE|COMT|ENSG1|Transcript|ENST1|protein_coding||||||||||YES||||||'
        ]
      ])

      const result = parseAnnotation(info, header, 'T')

      expect(result.impact).toBeNull()
      expect(result.consequence).toBe('synonymous_variant')
      expect(result.transcripts[0]).toMatchObject({
        consequence: null,
        func: 'synonymous_variant'
      })
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

    it('parses a multi-allelic annotation payload once into allele-indexed results', () => {
      const info = new Map([
        [
          'CSQ',
          'G|missense_variant|MODERATE|GENE1|E1|Transcript|T1|protein_coding||||||||||||||||,T|stop_gained|HIGH|GENE2|E2|Transcript|T2|protein_coding||||||||||||||||'
        ]
      ])

      const [gResult, tResult] = parseAnnotationsForAlleles(info, header, ['G', 'T'], 'A')

      expect(gResult.transcript).toBe('T1')
      expect(tResult.transcript).toBe('T2')
      expect(gResult.transcripts).toHaveLength(1)
      expect(tResult.transcripts).toHaveLength(1)
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

    it('disambiguates multi-allelic deletions via ALLELE_NUM when both use "-" notation', () => {
      // REF=CAT, ALT=C,CA — a two-deletion multi-allelic site. VEP emits "-" for
      // BOTH deletion ALTs, so the Allele-string heuristic alone cannot tell them
      // apart. ALLELE_NUM (1-based index of the ALT this block annotates) must
      // disambiguate: block 1 belongs to ALT index 1 (C), block 2 to ALT index 2 (CA).
      const fields = ['Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Feature', 'ALLELE_NUM']
      const alleleNumHeader = makeHeader({ annotationType: 'csq', csqFields: fields })
      const info = new Map([
        ['CSQ', '-|frameshift_variant|HIGH|GENE1|T1|1,-|inframe_deletion|MODERATE|GENE2|T2|2']
      ])

      // Split record for ALT index 1 (C) must get ONLY the GENE1/T1 annotation.
      const resultAllele1 = parseAnnotation(info, alleleNumHeader, 'C', 'CAT', 1)
      expect(resultAllele1.transcripts).toHaveLength(1)
      expect(resultAllele1.geneSymbol).toBe('GENE1')
      expect(resultAllele1.consequence).toBe('frameshift_variant')
      expect(resultAllele1.transcript).toBe('T1')

      // Split record for ALT index 2 (CA) must get ONLY the GENE2/T2 annotation.
      const resultAllele2 = parseAnnotation(info, alleleNumHeader, 'CA', 'CAT', 2)
      expect(resultAllele2.transcripts).toHaveLength(1)
      expect(resultAllele2.geneSymbol).toBe('GENE2')
      expect(resultAllele2.consequence).toBe('inframe_deletion')
      expect(resultAllele2.transcript).toBe('T2')
    })

    it('falls back to the Allele/length heuristic when ALLELE_NUM is absent from the CSQ config', () => {
      // Same csqFields as the main describe block (no ALLELE_NUM) — single-deletion
      // site, so the "-" shortcut alone is unambiguous and must still work.
      const info = new Map([
        ['CSQ', '-|frameshift_variant|HIGH|GENE1|E1|Transcript|T1|protein_coding||||||||||||||||']
      ])

      const result = parseAnnotation(info, header, 'C', 'CAT')
      expect(result.geneSymbol).toBe('GENE1')
      expect(result.transcripts).toHaveLength(1)
    })

    it('fails closed when a CSQ allele heuristic matches multiple original ALT alleles', () => {
      const info = new Map([
        [
          'CSQ',
          '-|frameshift_variant|HIGH|GENE1|E1|Transcript|T1|protein_coding||||||||||||||||,-|inframe_deletion|MODERATE|GENE2|E2|Transcript|T2|protein_coding||||||||||||||||'
        ]
      ])

      const first = parseAnnotation(info, header, 'C', 'CAT', 1, ['C', 'CA'])
      const second = parseAnnotation(info, header, 'CA', 'CAT', 2, ['C', 'CA'])

      expect(first.transcripts).toHaveLength(0)
      expect(second.transcripts).toHaveLength(0)
      expect(first.geneSymbol).toBeNull()
      expect(second.geneSymbol).toBeNull()
    })

    it("does not cross-contaminate multi-deletion splits when a block's ALLELE_NUM is declared but empty", () => {
      // REF=CAT, ALT=C,CA — same two-deletion site as above, but block 2 (GENE2)
      // has NO ALLELE_NUM value even though the CSQ header declares the field.
      // Falling back to the lossy "-"/length heuristic here would let GENE2
      // cross-match BOTH split records (VEP emits "-" for every deletion ALT).
      // Correct behavior: without ALLELE_NUM to disambiguate, a "-" block must
      // not guess — it must match neither split, while GENE1 (which does carry
      // ALLELE_NUM=1) still matches only its own allele.
      const fields = ['Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Feature', 'ALLELE_NUM']
      const alleleNumHeader = makeHeader({ annotationType: 'csq', csqFields: fields })
      const info = new Map([
        ['CSQ', '-|frameshift_variant|HIGH|GENE1|T1|1,-|inframe_deletion|MODERATE|GENE2|T2|']
      ])

      // Split record for ALT index 1 (C): GENE1 matches via its explicit
      // ALLELE_NUM=1; GENE2 (no ALLELE_NUM) must NOT cross-attach.
      const resultAllele1 = parseAnnotation(info, alleleNumHeader, 'C', 'CAT', 1)
      expect(resultAllele1.transcripts).toHaveLength(1)
      expect(resultAllele1.geneSymbol).toBe('GENE1')

      // Split record for ALT index 2 (CA): GENE1 is excluded (ALLELE_NUM=1 !== 2)
      // and GENE2 must ALSO be excluded — it cannot be disambiguated, so it must
      // match nothing rather than guessing via the dash/length heuristic.
      const resultAllele2 = parseAnnotation(info, alleleNumHeader, 'CA', 'CAT', 2)
      expect(resultAllele2.transcripts).toHaveLength(0)
      expect(resultAllele2.geneSymbol).toBeNull()
    })

    it('does not use allele heuristics when ALLELE_NUM is declared but empty', () => {
      // Once the header declares ALLELE_NUM, it is the authoritative mapping.
      // Falling back for just one malformed block can cross-attach an inserted-
      // bases suffix to another ALT at a mixed multi-allelic site.
      const fields = ['Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Feature', 'ALLELE_NUM']
      const alleleNumHeader = makeHeader({ annotationType: 'csq', csqFields: fields })
      const info = new Map([['CSQ', 'TT|frameshift_variant|HIGH|GENE3|T3|']])

      const result = parseAnnotation(info, alleleNumHeader, 'ATT', 'A', 1)
      expect(result.transcripts).toHaveLength(0)
      expect(result.geneSymbol).toBeNull()
    })

    it.each(['', '0', '-1', '01', '+1', ' 1', '1 ', '1junk', '9007199254740992'])(
      'rejects malformed ALLELE_NUM %j',
      (alleleNum) => {
        const fields = ['Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Feature', 'ALLELE_NUM']
        const alleleNumHeader = makeHeader({ annotationType: 'csq', csqFields: fields })
        const info = new Map([['CSQ', `G|missense_variant|MODERATE|GENE4|T4|${alleleNum}`]])

        const result = parseAnnotation(info, alleleNumHeader, 'G', 'A', 1)
        expect(result.transcripts).toHaveLength(0)
        expect(result.geneSymbol).toBeNull()
      }
    )

    it('rejects ALLELE_NUM annotations when the caller omits the allele index', () => {
      const fields = ['Allele', 'Consequence', 'IMPACT', 'SYMBOL', 'Feature', 'ALLELE_NUM']
      const alleleNumHeader = makeHeader({ annotationType: 'csq', csqFields: fields })
      const info = new Map([['CSQ', 'G|missense_variant|MODERATE|GENE4|T4|1']])

      const result = parseAnnotation(info, alleleNumHeader, 'G', 'A')
      expect(result.transcripts).toHaveLength(0)
      expect(result.geneSymbol).toBeNull()
    })

    it('retains the highest-impact CSQ block when one transcript appears more than once', () => {
      const info = new Map([
        [
          'CSQ',
          'G|upstream_gene_variant|MODIFIER|GENE1|E1|Transcript|T1|protein_coding||||||||||||||||,G|stop_gained|HIGH|GENE1|E1|Transcript|T1|protein_coding||||||||||||||||'
        ]
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result).toMatchObject({ impact: 'HIGH', consequence: 'stop_gained', transcript: 'T1' })
      expect(result.transcripts).toEqual([
        expect.objectContaining({
          transcript_id: 'T1',
          consequence: 'HIGH',
          func: 'stop_gained',
          is_selected: 1
        })
      ])
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
      // Canonical model: per-transcript `consequence` = IMPACT, `func` = SO term.
      expect(result.transcripts[0].consequence).toBe('MODERATE')
      expect(result.transcripts[0].func).toBe('missense_variant')
    })

    it.each([
      ['G-C', 'G'],
      ['C-chr1:123456_A>T', 'C']
    ])('matches standard compound ANN allele %s to its leading ALT %s', (annAllele, alt) => {
      const info = new Map([
        [
          'ANN',
          `${annAllele}|missense_variant|MODERATE|GENE1|E1|transcript|T1|protein_coding||||||||`
        ]
      ])

      const matched = parseAnnotation(info, header, alt, 'A', 1, [alt, 'T'])
      const other = parseAnnotation(info, header, 'T', 'A', 2, [alt, 'T'])

      expect(matched.transcripts).toHaveLength(1)
      expect(matched.geneSymbol).toBe('GENE1')
      expect(other.transcripts).toHaveLength(0)
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

    it('disambiguates multi-allelic deletions by exact sequence, never via the "-" shortcut', () => {
      // REF=CAT, ALT=C,CA. Unlike VEP, SnpEff's ANN allele field (index 0) always
      // carries the real ALT sequence, so C and CA disambiguate by exact match.
      // A third, pathological block using literal "-" (as VEP would) proves the
      // "-"/length shortcut is disabled for ANN — it must never cross-match a
      // real deletion allele just because it's shorter than REF.
      const info = new Map([
        [
          'ANN',
          'C|frameshift_variant|HIGH|GENE1|E1|transcript|T1|protein_coding|1/1|c.1_2del|p.X1fs|||||,' +
            'CA|inframe_deletion|MODERATE|GENE2|E2|transcript|T2|protein_coding|1/1|c.2del|p.X2del|||||,' +
            '-|intergenic_region|MODIFIER|GENE3|E3|transcript|T3|protein_coding|||||||||'
        ]
      ])

      // Split record for ALT=C must match ONLY the GENE1/T1 block by exact sequence.
      const resultAllele1 = parseAnnotation(info, header, 'C', 'CAT')
      expect(resultAllele1.transcripts).toHaveLength(1)
      expect(resultAllele1.geneSymbol).toBe('GENE1')
      expect(resultAllele1.transcript).toBe('T1')

      // Split record for ALT=CA must match ONLY the GENE2/T2 block.
      const resultAllele2 = parseAnnotation(info, header, 'CA', 'CAT')
      expect(resultAllele2.transcripts).toHaveLength(1)
      expect(resultAllele2.geneSymbol).toBe('GENE2')
      expect(resultAllele2.transcript).toBe('T2')
    })

    it("does not cross-attach a shorter split's ANN block via the VEP insertion-suffix heuristic", () => {
      // REF=A, ALT=AT,T — a mixed insertion/SNV multi-allelic site. SnpEff's ANN
      // allele field is always the full raw ALT string (confirmed against real
      // SnpEff output, e.g. tests/test-data/vcf/single-sample.snpeff.vcf.gz
      // REF=T ALT=TTATC -> ANN=TTATC|...), so "AT" and "T" disambiguate by exact
      // match. VEP's "inserted bases only" heuristic ("AT".substring(1) === "T")
      // must NOT apply to ANN — otherwise the T block would falsely cross-attach
      // to the AT split.
      const info = new Map([
        [
          'ANN',
          'AT|frameshift_variant|HIGH|GENE_AT|E1|transcript|T1|protein_coding|1/1|c.1_2insT|p.X1fs|||||,' +
            'T|missense_variant|MODERATE|GENE_T|E2|transcript|T2|protein_coding|1/1|c.1A>T|p.X1Y|||||'
        ]
      ])

      // Split record for ALT=AT must match ONLY the GENE_AT/T1 block.
      const resultAt = parseAnnotation(info, header, 'AT', 'A')
      expect(resultAt.transcripts).toHaveLength(1)
      expect(resultAt.geneSymbol).toBe('GENE_AT')
      expect(resultAt.transcript).toBe('T1')

      // Split record for ALT=T must match ONLY the GENE_T/T2 block — it must NOT
      // also pick up the AT block via the substring(1) cross-match.
      const resultT = parseAnnotation(info, header, 'T', 'A')
      expect(resultT.transcripts).toHaveLength(1)
      expect(resultT.geneSymbol).toBe('GENE_T')
      expect(resultT.transcript).toBe('T2')
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

    it('retains the highest-impact ANN block when one transcript appears more than once', () => {
      const info = new Map([
        [
          'ANN',
          'G|upstream_gene_variant|MODIFIER|GENE1|E1|transcript|T1|protein_coding||||||||,' +
            'G|stop_gained|HIGH|GENE1|E1|transcript|T1|protein_coding||||||||'
        ]
      ])

      const result = parseAnnotation(info, header, 'G')

      expect(result).toMatchObject({ impact: 'HIGH', consequence: 'stop_gained', transcript: 'T1' })
      expect(result.transcripts).toEqual([
        expect.objectContaining({
          transcript_id: 'T1',
          consequence: 'HIGH',
          func: 'stop_gained',
          is_selected: 1
        })
      ])
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

  describe('allocation budgets', () => {
    it('rejects excessive annotation and per-annotation field fanout', () => {
      const csqHeader = makeHeader({ annotationType: 'csq', csqFields: ['Allele'] })
      const manyAnnotations = Array.from({ length: MAX_VCF_ANNOTATIONS + 1 }, () => 'G').join(',')
      expect(() => parseAnnotation(new Map([['CSQ', manyAnnotations]]), csqHeader, 'G')).toThrow(
        VcfResourceLimitError
      )

      const manyFields = Array.from({ length: MAX_VCF_ANNOTATION_FIELDS + 1 }, () => 'G').join('|')
      expect(() =>
        parseAnnotation(new Map([['ANN', manyFields]]), makeHeader({ annotationType: 'ann' }), 'G')
      ).toThrow(VcfResourceLimitError)
    })

    it('rejects annotation-to-allele match amplification before building output graphs', () => {
      const csqHeader = makeHeader({
        annotationType: 'csq',
        csqFields: ['Allele', 'Feature']
      })
      const annotations = Array.from({ length: 2_000 }, (_, index) => `-|T${index}`).join(',')
      const deletionAlts = Array.from({ length: 1_000 }, () => 'A')

      expect(() =>
        parseAnnotationsForAlleles(new Map([['CSQ', annotations]]), csqHeader, deletionAlts, 'AA')
      ).toThrow(VcfResourceLimitError)
    })
  })
})
