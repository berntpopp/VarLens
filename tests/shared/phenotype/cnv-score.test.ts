import { describe, expect, it } from 'vitest'
import {
  cnvGeneSet,
  cnvType,
  regionWeight,
  scoreCnv,
  type CnvCall,
  type CnvGene,
  type CnvPhenotypeScorer,
  type CnvScoreContext,
  type GeneSpan,
  type GeneSpanLookup
} from '../../../src/shared/phenotype/cnv-score'
import type {
  DosageGene,
  DosageRegion,
  LocusReference
} from '../../../src/shared/types/locus-reference'

const span = (symbol: string, start: number, end: number, n: number): GeneSpan => ({
  chr: '16',
  start,
  end,
  symbol,
  hgncId: `HGNC:${n}`,
  coding: true
})

// 27 protein-coding genes across 16p11.2 BP4–BP5; 9 of them in the phenotype index.
const GENES: CnvGene[] = Array.from({ length: 27 }, (_, i) => {
  const symbol = i === 13 ? 'TBX6' : `G16P${i}`
  return { symbol, span: span(symbol, 29_650_000 + i * 20_000, 29_660_000 + i * 20_000, i + 1) }
})
const INDEXED: Record<string, number> = { TBX6: 0.62 }
for (let i = 0; i < 8; i++) INDEXED[`G16P${i}`] = 0.3 + i * 0.02

const DISEASES: Record<string, number> = { 'OMIM:611913': 0.71, 'OMIM:614671': 0.1 }

function scorer(scores: Record<string, number> = INDEXED): CnvPhenotypeScorer {
  return {
    score: (g) => scores[g] ?? null,
    bestDisease: (g) => (g in scores ? `OMIM:${g}` : null),
    scoreDiseases(ids) {
      let best: { score: number; disease: string } | null = null
      for (const id of ids) {
        const s = DISEASES[id]
        if (s !== undefined && (best === null || s > best.score)) best = { score: s, disease: id }
      }
      return best
    }
  }
}

const REGION: DosageRegion = {
  iscaId: 'ISCA-37400',
  build: 'GRCh38',
  chr: 'chr16',
  start: 29_638_676,
  end: 30_188_531,
  label: '16p11.2 BP4-BP5',
  hi: 3,
  ts: 3,
  lossDiseases: ['OMIM:611913'],
  gainDiseases: ['OMIM:614671']
}

function reference(genes: DosageGene[] = [], regions: DosageRegion[] = [REGION]): LocusReference {
  return {
    dosageGenes: new Map(genes.map((g) => [g.hgncId, g])),
    dosageRegions: regions,
    strLoci: [],
    sources: { clingen: '2026-10-14' }
  }
}
const TBX6_HI3: DosageGene = { hgncId: 'HGNC:14', symbol: 'TBX6', hi: 3, ts: null }

function ctx(over: Partial<CnvScoreContext> = {}): CnvScoreContext {
  return {
    build: 'GRCh38',
    sex: 'female',
    reference: reference([TBX6_HI3]),
    scorer: scorer(),
    ...over
  }
}

const DEL: CnvCall = {
  chr: 'chr16',
  pos: 29_600_000,
  end_pos: 30_200_000,
  sv_type: 'DEL',
  cnv_copy_number: 1
}
const DUP: CnvCall = { ...DEL, sv_type: 'DUP', cnv_copy_number: 3 }

describe('region coverage v(cov) (spec §4.2)', () => {
  it.each([
    [0.29, 0],
    [0.3, 0],
    [0.55, 0.5],
    [0.8, 1],
    [1, 1]
  ])('v(%s) = %s', (cov, v) => expect(regionWeight(cov)).toBeCloseTo(v, 12))
})

describe('CNV type', () => {
  const base = { chr: 'chr1', pos: 1_000_000 }
  it('reads sv_type, else the copy number against the reference CN', () => {
    expect(cnvType({ ...base, sv_type: 'DEL' }, ctx())).toBe('del')
    expect(cnvType({ ...base, sv_type: 'DUP:TANDEM' }, ctx())).toBe('dup')
    expect(cnvType({ ...base, sv_type: 'CNV', cnv_copy_number: 1 }, ctx())).toBe('del')
    expect(cnvType({ ...base, cnv_copy_number: 3 }, ctx())).toBe('dup')
    expect(cnvType({ ...base, sv_type: 'CNV', cnv_copy_number: 2 }, ctx())).toBeNull()
  })
  it('uses reference CN 1 on male chrX outside the PARs only', () => {
    const male = ctx({ sex: 'male' })
    expect(cnvType({ chr: 'X', pos: 50_000_000, cnv_copy_number: 1 }, male)).toBeNull()
    expect(cnvType({ chr: 'X', pos: 50_000_000, cnv_copy_number: 2 }, male)).toBe('dup')
    expect(cnvType({ chr: 'X', pos: 50_000_000, cnv_copy_number: 0 }, male)).toBe('del')
    expect(cnvType({ chr: 'X', pos: 100_000, cnv_copy_number: 1 }, male)).toBe('del')
    expect(cnvType({ chr: 'X', pos: 50_000_000, cnv_copy_number: 1 }, ctx())).toBe('del')
  })
  it.each(['INV', 'BND', 'INS'])('%s gives null', (sv_type) => {
    expect(cnvType({ ...base, sv_type, cnv_copy_number: 1 }, ctx())).toBeNull()
    expect(scoreCnv({ ...base, sv_type }, GENES, ctx())).toBeNull()
  })
})

describe('gene route (#642: plain best overlapped gene)', () => {
  const one = (symbol: string, n: number): CnvGene[] => [
    { symbol, span: span(symbol, 29_700_000, 29_710_000, n) }
  ]

  it('a single-gene CNV equals the SNV score for every gene score', () => {
    const genes = one('TBX6', 14)
    for (const s of [0, 0.25, 0.41, 0.62, 0.99]) {
      const r = scoreCnv(
        DEL,
        genes,
        ctx({ scorer: scorer({ TBX6: s }), reference: reference([TBX6_HI3], []) })
      )
      expect(r?.score).toBe(s)
    }
  })

  it('picks the highest-scoring overlapped gene and breaks ties by input order', () => {
    const genes: CnvGene[] = [
      { symbol: 'A', span: span('A', 100, 200, 1) },
      { symbol: 'B', span: span('B', 300, 400, 2) }
    ]
    const tied = scoreCnv(
      DEL,
      genes,
      ctx({ scorer: scorer({ A: 0.7, B: 0.7 }), reference: reference([], []) })
    )!
    expect(tied).toMatchObject({ score: 0.7, bestLocus: 'A', bestDisease: 'OMIM:A', geneCount: 2 })
    const bWins = scoreCnv(
      DEL,
      genes,
      ctx({ scorer: scorer({ A: 0.7, B: 0.8 }), reference: reference([], []) })
    )!
    expect(bWins).toMatchObject({ score: 0.8, bestLocus: 'B', bestDisease: 'OMIM:B', geneCount: 2 })
  })

  it('counts protein-coding genes only and omits dosage from the gene note', () => {
    const genes = [
      ...one('TBX6', 14),
      { symbol: 'LNC1', span: { ...span('LNC1', 1, 2, 99), coding: false } }
    ]
    const r = scoreCnv(DEL, genes, ctx({ reference: reference([TBX6_HI3], []) }))!
    expect(r).toMatchObject({ bestLocus: 'TBX6', bestDisease: 'OMIM:TBX6', geneCount: 1 })
    expect(r.note).toEqual({
      kind: 'gene',
      id: 'TBX6',
      label: 'TBX6',
      diseaseGenes: 1,
      genes: 1
    })
  })

  it('fast-paths empty genes and regions, and keeps geneCount without HPO data or locus tables', () => {
    expect(scoreCnv(DEL, [], ctx({ reference: reference([], []) }))).toEqual({
      score: null,
      bestDisease: null,
      bestLocus: null,
      geneCount: 0,
      note: null
    })
    expect(scoreCnv(DEL, GENES, ctx({ scorer: null }))).toMatchObject({
      score: null,
      geneCount: 27
    })
    expect(scoreCnv(DEL, GENES, ctx({ reference: null }))).toMatchObject({
      score: null,
      geneCount: 27
    })
  })
})

describe('16p11.2 worked example (spec §4.4, #642)', () => {
  it('the gene route takes the best overlapped gene over 9 indexed genes', () => {
    const r = scoreCnv(DEL, GENES, ctx({ reference: reference([TBX6_HI3], []) }))!
    expect(r).toMatchObject({ score: 0.62, bestLocus: 'TBX6', geneCount: 27 })
    expect(r.note).toMatchObject({ kind: 'gene', diseaseGenes: 9, genes: 27 })
  })

  it('the region beats the gene when S_region > S_gene', () => {
    const r = scoreCnv(DEL, GENES, ctx())!
    expect(r).toMatchObject({
      score: 0.71,
      bestDisease: 'OMIM:611913',
      bestLocus: 'ISCA-37400',
      geneCount: 27
    })
    expect(r.note).toMatchObject({
      kind: 'region',
      coverage: 1,
      diseaseGenes: 9,
      genes: 27,
      dosage: 'HI 3 (ClinGen 2026-10-14)'
    })
  })

  it('the same interval duplicated uses the gene route when gain disease scores lower', () => {
    const del = scoreCnv(DEL, GENES, ctx())!
    const dup = scoreCnv(DUP, GENES, ctx())!
    expect(dup.score).toBe(0.62)
    expect(dup.bestLocus).toBe('TBX6')
    expect(dup.score!).toBeLessThan(del.score!)
  })

  it('a region in the other build or below 30 % coverage is ignored', () => {
    expect(scoreCnv(DEL, GENES, ctx({ build: 'GRCh37' }))!.bestLocus).toBe('TBX6')
    const small = { ...DEL, pos: 29_638_676, end_pos: 29_638_676 + 150_000 }
    expect(scoreCnv(small, GENES, ctx())!.note?.kind).toBe('gene')
  })
})

describe('gene set: CSQ genes vs interval fallback', () => {
  const spans = [span('A', 100, 200, 1), span('B', 150, 400, 2), span('C', 500, 600, 3)]
  const lookup: GeneSpanLookup = {
    overlapping: (_chr, a, b) => spans.filter((s) => s.start <= b && s.end >= a),
    span: (symbol) => spans.find((s) => s.symbol === symbol)
  }

  it('uses the distinct CSQ genes, with their spans when known', () => {
    expect(cnvGeneSet(['B', 'B', 'X'], lookup, '16', 120, 300)).toEqual([
      { symbol: 'B', span: spans[1] },
      { symbol: 'X', span: undefined }
    ])
  })

  it('drops a CSQ gene whose span misses the CNV (VEP upstream/downstream gene)', () => {
    // C (500–600) is within VEP's 5 kb of a 120–300 call but not overlapped.
    expect(cnvGeneSet(['B', 'C'], lookup, '16', 120, 300)).toEqual([
      { symbol: 'B', span: spans[1] }
    ])
    expect(cnvGeneSet(['C'], lookup, '16', 120, 500)).toEqual([{ symbol: 'C', span: spans[2] }])
  })

  it('falls back to interval overlap without CSQ genes', () => {
    const want = [
      { symbol: 'A', span: spans[0] },
      { symbol: 'B', span: spans[1] }
    ]
    expect(cnvGeneSet(undefined, lookup, '16', 120, 300)).toEqual(want)
    expect(cnvGeneSet([], lookup, '16', 120, 300)).toEqual(want)
  })
})

describe('region index', () => {
  it('skips zero-length and non-sensitive regions', () => {
    const regions = [
      { ...REGION, iscaId: 'ISCA-0', end: REGION.start },
      { ...REGION, iscaId: 'ISCA-40', hi: 40 as const }
    ]
    const r = scoreCnv(DEL, GENES, ctx({ reference: reference([TBX6_HI3], regions) }))!
    expect(r.bestLocus).toBe('TBX6')
  })
})
