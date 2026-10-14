import { describe, expect, it } from 'vitest'
import {
  armEnv,
  prepareCnv,
  scoreArms,
  standingAmong
} from '../../../../scripts/shortlist-sim/cnv-str/cnv-arms'
import { rankProfile } from '../../../../scripts/shortlist-sim/cnv-str/cnv-bench'
import { parseCnvText } from '../../../../scripts/shortlist-sim/cnv-str/cnv-phenopackets'
import { sampleType } from '../../../../scripts/shortlist-sim/cnv-str/backgrounds'
import { phenotypeIds } from '../../../../scripts/shortlist-sim/cnv-str/cnv-sim'
import {
  allowedDiseases,
  drawDecoys,
  normalMax
} from '../../../../scripts/shortlist-sim/cnv-str/str-sim'
import { rng } from '../../../../scripts/shortlist-sim/common/rng'
import type {
  CnvPhenotypeScorer,
  GeneSpan,
  GeneSpanLookup
} from '../../../../src/shared/phenotype/cnv-score'
import type { LocusReference, StrLocus } from '../../../../src/shared/types/locus-reference'

// Fabricated genes on chr1: A [100, 200], B [300, 400], C [500, 600]; region R covers 1000-2000.
const SPANS: GeneSpan[] = [
  { chr: '1', start: 100, end: 200, symbol: 'A', hgncId: 'HGNC:1', coding: true },
  { chr: '1', start: 300, end: 400, symbol: 'B', hgncId: 'HGNC:2', coding: true },
  { chr: '1', start: 500, end: 600, symbol: 'C', hgncId: 'HGNC:3', coding: true }
]
const lookup: GeneSpanLookup = {
  overlapping: (chr, a, b) => SPANS.filter((s) => s.chr === chr && s.end >= a && s.start <= b),
  span: (symbol) => SPANS.find((s) => s.symbol === symbol)
}
const reference: LocusReference = {
  dosageGenes: new Map([['HGNC:1', { hgncId: 'HGNC:1', symbol: 'A', hi: 3, ts: null }]]),
  dosageRegions: [
    {
      iscaId: 'ISCA-1',
      build: 'GRCh38',
      chr: '1',
      start: 1000,
      end: 2000,
      label: 'R',
      hi: 3,
      ts: null,
      lossDiseases: ['OMIM:9'],
      gainDiseases: []
    }
  ],
  strLoci: [],
  sources: {}
}
const S: Record<string, number> = { A: 0.5, B: 0.8, C: 0.2 }
const scorer: CnvPhenotypeScorer = {
  score: (g) => S[g] ?? null,
  bestDisease: (g) => (g in S ? `OMIM:${g}` : null),
  scoreDiseases: (ids) => (ids.includes('OMIM:9') ? { score: 0.9, disease: 'OMIM:9' } : null),
  sidak: (s, n) => s / n // fixture only: monotone in n
}
const env = armEnv('GRCh38', reference)
const del = (start: number, end: number) => ({ chr: '1', start, end, type: 'del' as const })

describe('CNV arms', () => {
  it('A0 is the naive max over the indexed genes', () => {
    const { scores, n } = scoreArms(prepareCnv(del(50, 650), lookup, reference), scorer, env)
    expect(scores.A0).toBe(0.8)
    expect(n).toBe(3)
  })

  it('A1 weights, A2 adds Šidák, A3 adds regions, sum is Σ w·e^S', () => {
    const { scores } = scoreArms(prepareCnv(del(50, 650), lookup, reference), scorer, env)
    // A: HI 3 → w 1; B, C: unknown → 0.6.
    expect(scores.A1).toBeCloseTo(Math.max(0.5, 0.6 * 0.8, 0.6 * 0.2))
    expect(scores.A2).toBeCloseTo(1 * (0.5 / 3))
    expect(scores.A3).toBeCloseTo(scores.A2!)
    expect(scores.sum).toBeCloseTo(Math.exp(0.5) + 0.6 * Math.exp(0.8) + 0.6 * Math.exp(0.2))
    const region = scoreArms(prepareCnv(del(900, 2100), lookup, reference), scorer, env).scores
    expect(region.A2).toBeNull()
    expect(region.A3).toBeCloseTo(0.9)
  })

  it('ranks three fixture cases: the region case wins only in A3', () => {
    const bg = [{ sample: 's', large: false, cnvs: [prepareCnv(del(250, 450), lookup, reference)] }]
    const regionCase = rankProfile(
      [prepareCnv(del(900, 2100), lookup, reference)],
      bg,
      scorer,
      env,
      false
    )
    expect(regionCase[0].standing.A3).toEqual({ higher: 0, equal: 0 })
    expect(regionCase[0].standing.A2).toEqual({ higher: 1, equal: 0 })
    const geneCase = rankProfile(
      [prepareCnv(del(50, 250), lookup, reference)],
      bg,
      scorer,
      env,
      false
    )
    expect(geneCase[0].standing.A0).toEqual({ higher: 1, equal: 0 }) // B 0.8 beats A 0.5
    const empty = rankProfile(
      [prepareCnv(del(5000, 6000), lookup, reference)],
      bg,
      null,
      env,
      false
    )
    expect(empty[0].standing.A3).toEqual({ higher: 0, equal: 1 }) // no scorer: all null, tied
  })

  it('nulls rank below scores and tie each other', () => {
    expect(standingAmong(null, [0.1, null, null])).toEqual({ higher: 1, equal: 2 })
    expect(standingAmong(0.5, [0.5, 0.7, null])).toEqual({ higher: 1, equal: 1 })
  })
})

describe('real CNV parsing', () => {
  it.each([
    [
      '16q24.3(89261399_89419131)x1',
      { chr: '16', start: 89261399, end: 89419131, type: 'del', build: null }
    ],
    [
      'chr9:g.(?_136817307)_(138133487_?)del',
      { chr: '9', start: 136817307, end: 138133487, type: 'del', build: null }
    ],
    [
      'NC_000009.12:g.311735_398140del',
      { chr: '9', start: 311735, end: 398140, type: 'del', build: 'GRCh38' }
    ],
    [
      'NC_000002.11:g.213900960_213921017dup',
      { chr: '2', start: 213900960, end: 213921017, type: 'dup', build: 'GRCh37' }
    ],
    [
      'arr{hg38}9q34.11(128591376-128600369)x1',
      { chr: '9', start: 128591376, end: 128600369, type: 'del', build: 'GRCh38' }
    ],
    [
      '16q24.3(89 507776_89565 656)x1',
      { chr: '16', start: 89507776, end: 89565656, type: 'del', build: null }
    ]
  ])('%s', (text, expected) => expect(parseCnvText(text)).toEqual(expected))

  it.each([
    'chr9:g.(137614475_137614558)_qterdel',
    'chr22:g.49275958_49362964del(NCBI Build 36.1)',
    'Chr9:g.(108940763110561397)del(hg19)',
    '100kb deletion arr[GRCh37] 1p31.1(705835088-70682550)x1',
    'F8 duplication-GRCh37:154229849-154253268)'
  ])('drops %s', (text) => expect(parseCnvText(text)).toBeNull())
})

describe('background genotypes and ClinVar ids', () => {
  it('derives DEL/DUP from allele copy numbers', () => {
    expect(sampleType('0|1', ['<CN0>'])).toBe('del')
    expect(sampleType('1|2', ['<CN0>', '<CN3>'])).toBe('dup')
    expect(sampleType('0/1', ['<DUP>'])).toBe('dup')
    expect(sampleType('0|0', ['<CN0>'])).toBeNull()
    expect(sampleType('./.', ['<DEL>'])).toBeNull()
    // GATK-SV <CNV>: FORMAT CN decides, whatever the GT.
    expect(sampleType('./.', ['<CNV>'], '3')).toBe('dup')
    expect(sampleType('0/1', ['<CNV>'], '1')).toBe('del')
    expect(sampleType('0/0', ['<CNV>'], '2')).toBeNull()
  })

  it('maps OMIM and Orphanet phenotype ids', () => {
    expect(phenotypeIds('MONDO:MONDO:1,MedGen:C1,OMIM:611913|Orphanet:261197')).toEqual([
      'OMIM:611913',
      'ORPHA:261197'
    ])
  })
})

describe('STR simulation', () => {
  const fmr1: StrLocus = {
    id: 'FXS_FMR1',
    gene: 'FMR1',
    chrom: 'X',
    hg19: null,
    hg38: { start: 1, stop: 2 },
    pathogenicMotifs: ['CGG'],
    benignMax: 44,
    intermediateMin: 45,
    intermediateMax: 54,
    pathogenicMin: 200,
    inheritance: ['XD'],
    evidence: 'Definitive',
    onsetMin: null,
    onsetMax: null,
    diseases: {
      full: ['OMIM:300624'],
      premutation: ['OMIM:300623', 'OMIM:311360'],
      femaleOnly: ['OMIM:311360']
    }
  }

  it('is deterministic per seed and draws every decoy in the all arm', () => {
    expect(drawDecoys('male', rng(7))).toEqual(drawDecoys('male', rng(7)))
    expect(drawDecoys('female', rng(7), true)).toEqual(['tcf4', 'atxn2', 'rfc1', 'fmr1'])
  })

  it('drops femaleOnly diseases for males and bounds normal alleles', () => {
    expect([...allowedDiseases(fmr1, 'premutation', 'male')]).toEqual(['OMIM:300623'])
    expect(allowedDiseases(fmr1, 'normal', null).size).toBe(0)
    expect(normalMax(fmr1)).toBe(44)
    expect(normalMax({ ...fmr1, benignMax: null, intermediateMin: null })).toBe(199)
  })
})
