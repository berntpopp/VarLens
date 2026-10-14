import { describe, it, expect } from 'vitest'
import {
  GeneContextBuilder,
  deriveZygosity,
  alleleKey,
  type LightRow
} from '../../../../../src/main/services/scoring/evidence/case-context'

const r = (id: number, o: Partial<LightRow>): LightRow => ({
  id,
  chr: '1',
  pos: 100 + id,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'G1',
  gt_num: '0/1',
  ...o
})

describe('deriveZygosity', () => {
  const female = { build: 'GRCh38', sex: 'female' as const }
  const male = { build: 'GRCh38', sex: 'male' as const }

  it('maps genotype classes incl. assumed het', () => {
    expect(deriveZygosity(r(1, { gt_num: './1' }), female)).toBe('het')
    expect(deriveZygosity(r(1, { gt_num: '1/.' }), female)).toBe('het')
    expect(deriveZygosity(r(1, { gt_num: '1/1' }), female)).toBe('hom')
    expect(deriveZygosity(r(1, { gt_num: '1' }), female)).toBe('hemi')
    expect(deriveZygosity(r(1, { gt_num: null }), female)).toBeNull()
    expect(deriveZygosity(r(1, { gt_num: '0/0' }), female)).toBeNull()
  })

  it('male chrX non-PAR hom is hemi; PAR, female and unknown sex stay hom', () => {
    expect(deriveZygosity(r(1, { chr: 'X', pos: 50_000_000, gt_num: '1/1' }), male)).toBe('hemi')
    expect(deriveZygosity(r(1, { chr: 'chrX', pos: 50_000_000, gt_num: '1/1' }), male)).toBe('hemi')
    expect(deriveZygosity(r(1, { chr: 'X', pos: 1_000_000, gt_num: '1/1' }), male)).toBe('hom') // PAR1 GRCh38
    // Since per-build contig naming GRCh38 stores 'chrX', GRCh37 'X': both reach the PAR check
    expect(deriveZygosity(r(1, { chr: 'chrX', pos: 1_000_000, gt_num: '1/1' }), male)).toBe('hom')
    expect(alleleKey({ chr: 'chrX', pos: 5, ref: 'A', alt: 'G' })).toBe(
      alleleKey({ chr: 'X', pos: 5, ref: 'A', alt: 'G' })
    )
    expect(deriveZygosity(r(1, { chr: 'X', pos: 50_000_000, gt_num: '1/1' }), female)).toBe('hom')
    expect(
      deriveZygosity(r(1, { chr: 'X', pos: 50_000_000, gt_num: '1/1' }), {
        build: 'GRCh38',
        sex: null
      })
    ).toBe('hom')
    expect(deriveZygosity(r(1, { chr: '7', gt_num: '1/1' }), male)).toBe('hom')
    expect(deriveZygosity(r(1, { chr: 'X', pos: 50_000_000, gt_num: '0/1' }), male)).toBe('het')
  })
})

describe('alleleKey (production identity contract)', () => {
  const key = (chr: string, pos: number, ref: string, alt: string): string =>
    alleleKey({ chr, pos, ref, alt })

  it('normalises the chr prefix and allele case; an SNV is unchanged', () => {
    expect(key('chr1', 5, 'a', 'g')).toBe(key('1', 5, 'A', 'G'))
    expect(key('CHR1', 5, 'A', 'G')).toBe('1:5:A:G')
  })

  it('trims the common suffix, then the common prefix, keeping one base per side', () => {
    expect(key('1', 100, 'CTT', 'CT')).toBe('1:100:CT:C')
    expect(key('1', 99, 'ACTT', 'ACT')).toBe('1:100:CT:C') // extra left padding
    expect(key('1', 100, 'CT', 'C')).toBe('1:100:CT:C')
    expect(key('1', 100, 'AGC', 'ATC')).toBe('1:101:G:T') // padded SNV
    expect(key('1', 100, 'A', 'AT')).toBe('1:100:A:AT')
  })

  it('does not left-align: a repeat shift stays a different key (spec §4.3 limitation)', () => {
    expect(key('1', 101, 'TT', 'T')).not.toBe(key('1', 100, 'CTT', 'CT'))
  })
})

describe('GeneContextBuilder', () => {
  const info = { build: 'GRCh38', sex: 'female' as const }

  it('counts distinct het alleles across pages and types (Review Focus 2)', () => {
    const b = new GeneContextBuilder(info)
    b.add([r(1, {})]) // SNV page 1
    b.add([r(2, { ref: 'CT', alt: 'C' })]) // indel, another page
    const ctx = b.build()
    const d1 = ctx.derived(r(1, {}))
    expect(d1.gene_het_hits).toBe(2)
    expect(d1.partners).toEqual([2])
    expect(d1.compoundHetPartnerVariantIds).toEqual([2])
    expect(d1.partners).toBe(d1.partners) // memoized reference
    expect(d1.compoundHetPartnerVariantIds).toBe(d1.partners)
    expect(ctx.derived(r(2, { ref: 'CT', alt: 'C' })).partners).toEqual([1])
    expect(ctx.derived(r(2, { ref: 'CT', alt: 'C' })).compoundHetPartnerVariantIds).toEqual([1])
  })

  it('two spellings of the same allele are one allele (Review Focus 3)', () => {
    const b = new GeneContextBuilder(info)
    b.add([r(1, { pos: 100, ref: 'CTT', alt: 'CT' }), r(2, { pos: 99, ref: 'ACTT', alt: 'ACT' })])
    const ctx = b.build()
    const d = ctx.derived(r(1, { pos: 100, ref: 'CTT', alt: 'CT' }))
    expect(d.gene_het_hits).toBe(1)
    expect(d.partners).toEqual([])
  })

  it('hom rows count for gene_hits, not gene_het_hits; null gene counts itself', () => {
    const b = new GeneContextBuilder(info)
    b.add([r(1, {}), r(2, { gt_num: '1/1' }), r(3, { gene_symbol: null })])
    const ctx = b.build()
    expect(ctx.derived(r(1, {}))).toMatchObject({ gene_het_hits: 1, gene_hits: 2 })
    expect(ctx.derived(r(3, { gene_symbol: null }))).toMatchObject({
      gene_het_hits: 1,
      gene_hits: 1,
      partners: []
    })
  })

  it('a hom row has no compound-het partners', () => {
    const b = new GeneContextBuilder(info)
    b.add([r(1, {}), r(2, { gt_num: '1/1' })])
    expect(b.build().derived(r(2, { gt_num: '1/1' }))).toMatchObject({
      zygosity: 'hom',
      gene_het_hits: 1,
      partners: []
    })
  })
})

describe('compound-het phase label (#586)', () => {
  const info = { build: 'GRCh38', sex: null }
  const label = (rows: LightRow[], considerPhasing = true): unknown[] => {
    const builder = new GeneContextBuilder(info, considerPhasing)
    builder.add(rows)
    const ctx = builder.build()
    return rows.map((row) => ctx.derived(row).comphet_phase)
  }

  it('same phase set, opposite haplotypes: trans', () => {
    expect(label([r(1, { gt_num: '0|1', ps: 7 }), r(2, { gt_num: '1|0', ps: 7 })])).toEqual([
      'trans',
      'trans'
    ])
  })

  it('same phase set, same haplotype: cis — labelled, the partners stay', () => {
    const builder = new GeneContextBuilder(info, true)
    const rows = [r(1, { gt_num: '0|1', ps: 7 }), r(2, { gt_num: '0|1', ps: 7 })]
    builder.add(rows)
    const d = builder.build().derived(rows[0])
    expect(d.comphet_phase).toBe('cis')
    expect(d.partners).toEqual([2])
  })

  it('different, missing or unphased phase sets stay possible', () => {
    expect(label([r(1, { gt_num: '0|1', ps: 7 }), r(2, { gt_num: '1|0', ps: 8 })])).toEqual([
      'possible',
      'possible'
    ])
    // A phased genotype without PS is not assumed phased chromosome-wide.
    expect(label([r(1, { gt_num: '0|1' }), r(2, { gt_num: '1|0' })])).toEqual([
      'possible',
      'possible'
    ])
    expect(label([r(1, { gt_num: '0/1', ps: 7 }), r(2, { gt_num: '1|0', ps: 7 })])).toEqual([
      'possible',
      'possible'
    ])
  })

  it('any trans partner wins; cis only when every partner is cis', () => {
    const rows = [
      r(1, { gt_num: '0|1', ps: 7 }),
      r(2, { gt_num: '0|1', ps: 7 }),
      r(3, { gt_num: '0/1' })
    ]
    expect(label(rows)).toEqual(['possible', 'possible', 'possible'])
    rows.push(r(4, { gt_num: '1|0', ps: 7 }))
    expect(label(rows)[0]).toBe('trans')
  })

  it('no label without phasing considered or without partners', () => {
    expect(label([r(1, { gt_num: '0|1', ps: 7 }), r(2, { gt_num: '1|0', ps: 7 })], false)).toEqual([
      null,
      null
    ])
    expect(label([r(1, { gt_num: '0|1', ps: 7 })])).toEqual([null])
  })
})
