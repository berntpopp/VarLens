import { describe, expect, it } from 'vitest'
import {
  cnvGeneSet,
  cnvType,
  dosageWeight,
  parseInfoDosage,
  regionWeight,
  scoreCnv,
  type CnvCall,
  type CnvGene,
  type CnvPhenotypeScorer,
  type CnvScoreContext,
  type GeneSpan,
  type GeneSpanLookup
} from '../../../src/shared/phenotype/cnv-score'
import { sidak, type CaseScores } from '../../../src/shared/phenotype/phenotype-score'
import type {
  DosageGene,
  DosageRegion,
  LocusReference
} from '../../../src/shared/types/locus-reference'

// Spec §4.4: G = 5,000 genes; 40 score ≥ 0.62 (TBX6 is the lowest of them); upper-tail rank 349 is 0.41.
const G = 5000
const sorted = new Float64Array(G)
for (let i = 0; i < G; i++) {
  sorted[i] =
    i >= 4960
      ? 0.62 + (i - 4960) * 0.009
      : i === 4651
        ? 0.41
        : i < 4651
          ? (0.4 * i) / 4651
          : 0.42 + (0.19 * (i - 4652)) / 308
}
const cs = { sorted } as unknown as CaseScores

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
    },
    sidak: (s, n) => sidak(cs, s, n)
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
    hetHits: () => 0,
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
const NO_INFO = new Map()

describe('dosage weight (spec §4.1 table)', () => {
  const d = (hi: number | null, ts: number | null = null) => ({ hi, ts }) as never
  it.each([
    ['DEL HI 3', 'del', d(3), true, false, 1],
    ['DEL HI 2', 'del', d(2), true, false, 1],
    ['DEL HI unknown', 'del', d(null), true, false, 0.6],
    ['DEL HI 0', 'del', d(0), true, false, 0.6],
    ['DEL HI 1', 'del', d(1), true, false, 0.6],
    ['DEL HI 30', 'del', d(30), true, false, 0.3],
    ['DEL HI 30, second hit', 'del', d(30), true, true, 1],
    ['DEL HI 40', 'del', d(40), true, false, 0.1],
    ['DUP whole, TS 3', 'dup', d(null, 3), true, false, 1],
    ['DUP whole, TS 2', 'dup', d(null, 2), true, false, 1],
    ['DUP whole, TS unknown', 'dup', d(3, null), true, false, 0.3],
    ['DUP whole, TS 1', 'dup', d(null, 1), true, false, 0.3],
    ['DUP whole, TS 40', 'dup', d(null, 40), true, false, 0.1],
    ['DUP partial, HI 3', 'dup', d(3, 3), false, false, 0.5],
    ['DUP partial, HI unknown', 'dup', d(null, 3), false, false, 0.3],
    ['DUP partial, HI 40', 'dup', d(40), false, false, 0.05]
  ] as const)('%s', (_, type, dosage, whole, biallelic, w) => {
    expect(dosageWeight(type, dosage, whole, biallelic)).toBeCloseTo(w, 12)
  })
})

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
    expect(scoreCnv({ ...base, sv_type }, GENES, NO_INFO, ctx())).toBeNull()
  })
})

describe('gene route', () => {
  const one = (symbol: string, n: number): CnvGene[] => [
    { symbol, span: span(symbol, 29_700_000, 29_710_000, n) }
  ]

  it('a single-gene DEL with w = 1 equals the SNV score, for every gene score', () => {
    const genes = one('TBX6', 14)
    for (const s of new Set(sorted)) {
      const r = scoreCnv(
        DEL,
        genes,
        NO_INFO,
        ctx({ scorer: scorer({ TBX6: s }), reference: reference([TBX6_HI3], []) })
      )
      expect(r?.score).toBe(s)
    }
  })

  it('a whole-gene DUP of an HI 3 / TS-unknown gene ranks below the same DEL', () => {
    const c = ctx({ reference: reference([TBX6_HI3], []) })
    const del = scoreCnv(DEL, one('TBX6', 14), NO_INFO, c)!
    const dup = scoreCnv(DUP, one('TBX6', 14), NO_INFO, c)!
    expect(del.score).toBe(0.62)
    expect(dup.score).toBeCloseTo(0.3 * 0.62, 12)
    expect(dup.score!).toBeLessThan(del.score!)
  })

  it('HI 30: 0.3 without a second hit, 1.0 with CN 0 or another het allele', () => {
    const ar = reference([{ ...TBX6_HI3, hi: 30 }], [])
    const genes = one('TBX6', 14)
    expect(scoreCnv(DEL, genes, NO_INFO, ctx({ reference: ar }))!.score).toBeCloseTo(0.3 * 0.62, 12)
    expect(
      scoreCnv({ ...DEL, cnv_copy_number: 0 }, genes, NO_INFO, ctx({ reference: ar }))!.score
    ).toBe(0.62)
    expect(scoreCnv(DEL, genes, NO_INFO, ctx({ reference: ar, hetHits: () => 1 }))!.score).toBe(
      0.62
    )
  })

  it('INFO HI/TS (AnnotSV) overrides ClinGen', () => {
    const info = parseInfoDosage(
      JSON.stringify({ AnnotSV_HI: 'TBX6:40,OTHER:3', AnnotSV_TS: 'TBX6:3' })
    )
    expect(info.get('TBX6')).toEqual({ hi: 40, ts: 3 })
    const r = scoreCnv(DEL, one('TBX6', 14), info, ctx({ reference: reference([TBX6_HI3], []) }))!
    expect(r.score).toBeCloseTo(0.1 * 0.62, 12)
    expect(r.note?.dosage).toBe('HI 40 (AnnotSV)')
    expect(parseInfoDosage(null).size).toBe(0)
  })

  it('falls back to ClinGen per field: AnnotSV HI only keeps the ClinGen TS', () => {
    const info = parseInfoDosage(JSON.stringify({ AnnotSV_HI: 'TBX6:1' }))
    const ts3 = reference([{ ...TBX6_HI3, ts: 3 }], [])
    const dup = scoreCnv(DUP, one('TBX6', 14), info, ctx({ reference: ts3 }))!
    expect(dup.score).toBe(0.62)
    expect(dup.note?.dosage).toBe('TS 3 (ClinGen 2026-10-14)')
    const del = scoreCnv(DEL, one('TBX6', 14), info, ctx({ reference: ts3 }))!
    expect(del.note?.dosage).toBe('HI 1 (AnnotSV)')
  })

  it('names the ClinGen dosage source and counts protein-coding genes only', () => {
    const genes = [
      ...one('TBX6', 14),
      { symbol: 'LNC1', span: { ...span('LNC1', 1, 2, 99), coding: false } }
    ]
    const r = scoreCnv(DEL, genes, NO_INFO, ctx({ reference: reference([TBX6_HI3], []) }))!
    expect(r).toMatchObject({ bestLocus: 'TBX6', bestDisease: 'OMIM:TBX6', geneCount: 1 })
    expect(r.note).toMatchObject({
      kind: 'gene',
      dosage: 'HI 3 (ClinGen 2026-10-14)',
      diseaseGenes: 1,
      genes: 1
    })
  })

  it('keeps the gene count but nulls the score without HPO data or locus tables', () => {
    expect(scoreCnv(DEL, GENES, NO_INFO, ctx({ scorer: null }))).toMatchObject({
      score: null,
      geneCount: 27
    })
    expect(scoreCnv(DEL, GENES, NO_INFO, ctx({ reference: null }))).toMatchObject({
      score: null,
      geneCount: 27
    })
  })
})

describe('16p11.2 worked example (spec §4.4)', () => {
  it('the gene route is Šidák-corrected: 0.62 → 0.41 over 9 indexed genes', () => {
    const r = scoreCnv(DEL, GENES, NO_INFO, ctx({ reference: reference([TBX6_HI3], []) }))!
    expect(r).toMatchObject({ score: 0.41, bestLocus: 'TBX6', geneCount: 27 })
    expect(r.note).toMatchObject({ diseaseGenes: 9, genes: 27 })
  })

  it('the region beats the gene', () => {
    const r = scoreCnv(DEL, GENES, NO_INFO, ctx())!
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

  it('the same interval duplicated ranks below the deletion', () => {
    const del = scoreCnv(DEL, GENES, NO_INFO, ctx())!
    const dup = scoreCnv(DUP, GENES, NO_INFO, ctx())!
    // every gene TS unknown → w = 0.3; the gain disease scores 0.1 on a deletion-shaped profile
    expect(dup.score).toBeCloseTo(0.3 * 0.41, 12)
    expect(dup.bestLocus).toBe('TBX6')
    expect(dup.score!).toBeLessThan(del.score!)
  })

  it('a region in the other build or below 30 % coverage is ignored', () => {
    expect(scoreCnv(DEL, GENES, NO_INFO, ctx({ build: 'GRCh37' }))!.bestLocus).toBe('TBX6')
    const small = { ...DEL, pos: 29_638_676, end_pos: 29_638_676 + 150_000 }
    expect(scoreCnv(small, GENES, NO_INFO, ctx())!.note?.kind).toBe('gene')
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

  it('a CSQ gene without a span counts as partially covered (DUP)', () => {
    const genes: CnvGene[] = [{ symbol: 'TBX6' }]
    const c = ctx({ reference: reference([], []) })
    expect(scoreCnv(DUP, genes, NO_INFO, c)!.score).toBeCloseTo(0.5 * 0.6 * 0.62, 12)
  })
})

describe('region index', () => {
  it('skips zero-length and non-sensitive regions', () => {
    const regions = [
      { ...REGION, iscaId: 'ISCA-0', end: REGION.start },
      { ...REGION, iscaId: 'ISCA-40', hi: 40 as const }
    ]
    const r = scoreCnv(DEL, GENES, NO_INFO, ctx({ reference: reference([TBX6_HI3], regions) }))!
    expect(r.bestLocus).toBe('TBX6')
  })
})
