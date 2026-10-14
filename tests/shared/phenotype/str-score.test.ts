import { describe, expect, it } from 'vitest'
import { scoreStr, type StrCase, type StrRow } from '../../../src/shared/phenotype/str-score'
import type { LocusReference, StrLocus } from '../../../src/shared/types/locus-reference'

// Catalogue rows as L1 normalises them, overrides applied (spec §5.1).
const base = {
  hg19: null,
  benignMax: null,
  intermediateMin: null,
  intermediateMax: null,
  evidence: 'Definitive',
  onsetMin: null,
  onsetMax: null
}
const locus = (l: Partial<StrLocus> & Pick<StrLocus, 'id' | 'gene' | 'chrom'>): StrLocus => ({
  ...base,
  hg38: null,
  pathogenicMotifs: [],
  pathogenicMin: null,
  inheritance: [],
  diseases: { full: [] },
  ...l
})
const LOCI: StrLocus[] = [
  locus({
    id: 'TCF4_FECD3',
    gene: 'TCF4',
    chrom: 'chr18',
    hg38: { start: 55586155, stop: 55586227 },
    pathogenicMotifs: ['CAG'],
    benignMax: 40,
    pathogenicMin: 50,
    inheritance: ['AD'],
    diseases: { full: ['OMIM:613267'] }
  }),
  locus({
    id: 'ATXN3_SCA3',
    gene: 'ATXN3',
    chrom: 'chr14',
    hg19: { start: 92537354, stop: 92537396 },
    hg38: { start: 92071010, stop: 92071052 },
    pathogenicMotifs: ['CAG'],
    benignMax: 44,
    pathogenicMin: 60,
    inheritance: ['AD'],
    onsetMin: 20,
    onsetMax: 50,
    diseases: {
      full: ['OMIM:109150', 'ORPHA:98757', 'ORPHA:276238', 'ORPHA:276241', 'ORPHA:276244']
    }
  }),
  locus({
    id: 'FMR1_FXS',
    gene: 'FMR1',
    chrom: 'chrX',
    hg38: { start: 147912051, stop: 147912110 },
    pathogenicMotifs: ['CGG'],
    benignMax: 44,
    intermediateMin: 45,
    intermediateMax: 54,
    pathogenicMin: 200,
    inheritance: ['XD'],
    diseases: {
      full: ['OMIM:300624'],
      premutation: ['OMIM:300623', 'ORPHA:93256', 'OMIM:311360'],
      femaleOnly: ['OMIM:311360']
    }
  }),
  locus({
    id: 'RFC1_CANVAS',
    gene: 'RFC1',
    chrom: 'chr4',
    hg38: { start: 39348425, stop: 39348479 },
    pathogenicMotifs: ['AAGGG', 'ACAGG'],
    benignMax: 10,
    pathogenicMin: 400,
    inheritance: ['AR'],
    diseases: { full: ['OMIM:614575'] }
  }),
  locus({
    id: 'AR_SBMA',
    gene: 'AR',
    chrom: 'chrX',
    hg38: { start: 67545318, stop: 67545385 },
    pathogenicMotifs: ['CAG'],
    pathogenicMin: 38,
    inheritance: ['XR'],
    diseases: { full: ['OMIM:313200'] }
  }),
  locus({
    id: 'XYLT1_BSS',
    gene: 'XYLT1',
    chrom: 'chr16',
    pathogenicMin: 200,
    evidence: 'Refuted',
    diseases: { full: ['OMIM:264800'] }
  }),
  locus({
    id: 'HOXA13_HFGS',
    gene: 'HOXA13',
    chrom: 'chr7',
    hg19: { start: 27239445, stop: 27239480 },
    hg38: { start: 27199826, stop: 27199861 },
    pathogenicMin: 22,
    inheritance: ['AD'],
    diseases: { full: ['OMIM:140000'] }
  }),
  locus({
    id: 'HOXA13_2',
    gene: 'HOXA13',
    chrom: 'chr7',
    hg38: { start: 27199900, stop: 27199950 },
    pathogenicMin: 22,
    inheritance: ['AD'],
    diseases: { full: ['OMIM:140001'] }
  })
]
const REF: LocusReference = {
  dosageGenes: new Map(),
  dosageRegions: [],
  strLoci: LOCI,
  sources: {}
}

// Illustrative S(d) of spec §5.4; the gene-level best (Pitt-Hopkins, FXS) is never consulted.
const S: Record<string, number> = {
  'OMIM:613267': 0.03,
  'OMIM:610954': 0.68,
  'OMIM:109150': 0.74,
  'ORPHA:98757': 0.6,
  'OMIM:300624': 0.81,
  'OMIM:300623': 0.05,
  'OMIM:311360': 0.5,
  'OMIM:614575': 0.77,
  'OMIM:313200': 0.4,
  'OMIM:264800': 0.9,
  'OMIM:140000': 0.3
}
const hpo = {
  scoreDiseases(ids: readonly string[]): { score: number; disease: string } | null {
    const hits = ids.filter((d) => d in S).sort((a, b) => S[b] - S[a])
    return hits.length === 0 ? null : { score: S[hits[0]], disease: hits[0] }
  }
}
const cs = (o: Partial<StrCase> = {}): StrCase => ({
  build: 'GRCh38',
  sex: 'male',
  hpo,
  hetHits: () => 0,
  ...o
})
const row = (o: Partial<StrRow>): StrRow => ({
  chr: 'chr1',
  pos: 1,
  ref: 'N',
  gene_symbol: null,
  gt_num: '0/1',
  ...o
})

describe('scoreStr worked examples (spec §5.4)', () => {
  it('TCF4 CTG18.1 85/20 scores FECD3 only, never Pitt-Hopkins', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'TCF4', str_alt_copies: '85/20', str_repeat_unit: 'CTG' }),
      REF,
      cs({ sex: 'female' })
    )
    expect(r).toMatchObject({
      score: 0.03,
      bestDisease: 'OMIM:613267',
      bestLocus: 'TCF4_FECD3',
      band: 'full'
    })
  })

  it('ATXN3 CAG 72/24 scores MJD with the locus note', () => {
    const r = scoreStr(
      row({ str_variant_catalog_id: 'ATXN3', str_alt_copies: '72/24', str_repeat_unit: 'CAG' }),
      REF,
      cs()
    )
    expect(r).toMatchObject({ score: 0.74, bestDisease: 'OMIM:109150', band: 'full' })
    expect(r!.note).toEqual({
      kind: 'str',
      id: 'ATXN3_SCA3',
      label: 'ATXN3',
      band: 'full',
      copies: '72/24',
      motif: 'CAG',
      inheritance: 'AD',
      onset: '20–50'
    })
  })

  it('FMR1 CGG 95 in a boy scores the premutation set, FXPOI dropped', () => {
    const r = scoreStr(
      row({ chr: 'chrX', str_repeat_id: 'FMR1', str_alt_copies: '95', gt_num: '1' }),
      REF,
      cs()
    )
    expect(r).toMatchObject({ score: 0.05, bestDisease: 'OMIM:300623', band: 'premutation' })
  })

  it('FMR1 premutation in a girl keeps FXPOI', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'FMR1', str_alt_copies: '95/30' }),
      REF,
      cs({ sex: 'female' })
    )
    expect(r).toMatchObject({ score: 0.5, bestDisease: 'OMIM:311360' })
  })

  it('RFC1 AAGGG 900/12 without a second allele: AR gate fails, band still full', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'RFC1', str_alt_copies: '900/12', str_repeat_unit: 'AAGGG' }),
      REF,
      cs()
    )
    expect(r).toMatchObject({ score: null, bestDisease: null, bestLocus: null, band: 'full' })
  })

  it('RFC1 900/12 plus a het RFC1 SNV passes the gate', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'RFC1', str_alt_copies: '900/12', str_repeat_unit: 'AAGGG' }),
      REF,
      cs({ hetHits: (g) => (g === 'RFC1' ? 1 : 0) })
    )
    expect(r).toMatchObject({ score: 0.77, bestDisease: 'OMIM:614575' })
  })

  it('RFC1 biallelic 900/850 passes without a second hit', () => {
    const r = scoreStr(row({ str_repeat_id: 'RFC1', str_alt_copies: '900/850' }), REF, cs())
    expect(r?.score).toBe(0.77)
  })
})

describe('scoreStr band, motif and gates', () => {
  it('RFC1 AAAAG (benign motif, any rotation) is normal', () => {
    for (const unit of ['AAAAG', 'AAGAA', 'CTTTT']) {
      const r = scoreStr(
        row({ str_repeat_id: 'RFC1', str_alt_copies: '900/850', str_repeat_unit: unit }),
        REF,
        cs()
      )
      expect(r).toMatchObject({ score: null, band: 'normal' })
    }
  })

  it('a reverse-complement motif (CTG for CAG) still matches', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'ATXN3', str_alt_copies: '72/24', str_repeat_unit: 'CTG' }),
      REF,
      cs()
    )
    expect(r?.band).toBe('full')
  })

  it('a Refuted locus gives a null score', () => {
    const r = scoreStr(row({ str_repeat_id: 'XYLT1', str_alt_copies: '500/20' }), REF, cs())
    expect(r).toMatchObject({ score: null, band: 'full' })
  })

  it('an unparsable REPCN falls back to the per-allele Stranger status', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'ATXN3', str_alt_copies: '.', str_status: 'normal,full_mutation' }),
      REF,
      cs()
    )
    expect(r).toMatchObject({ band: 'full', score: 0.74 })
    const pre = scoreStr(row({ str_repeat_id: 'FMR1', str_status: 'pre_mutation' }), REF, cs())
    expect(pre?.band).toBe('premutation')
  })

  it('a hom full_mutation status counts as biallelic for AR', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'RFC1', str_status: 'full_mutation', gt_num: '1/1' }),
      REF,
      cs()
    )
    expect(r?.score).toBe(0.77)
  })

  it('normal copies give a null score and band normal', () => {
    const r = scoreStr(row({ str_repeat_id: 'ATXN3', str_alt_copies: '24/20' }), REF, cs())
    expect(r).toMatchObject({ score: null, band: 'normal' })
  })

  it('XR is null in a female, scored in a male and when sex is unknown', () => {
    const r = row({ chr: 'chrX', str_repeat_id: 'AR', str_alt_copies: '45/20' })
    expect(scoreStr(r, REF, cs({ sex: 'female' }))?.score).toBeNull()
    expect(scoreStr(r, REF, cs())?.score).toBe(0.4)
    expect(scoreStr(r, REF, cs({ sex: null }))?.score).toBe(0.4)
  })

  it('unknown sex keeps femaleOnly diseases', () => {
    const r = scoreStr(row({ str_repeat_id: 'FMR1', str_alt_copies: '95' }), REF, cs({ sex: null }))
    expect(r?.bestDisease).toBe('OMIM:311360')
  })

  it('without HPO terms the band is still set and the score null', () => {
    const r = scoreStr(
      row({ str_repeat_id: 'ATXN3', str_alt_copies: '72/24' }),
      REF,
      cs({ hpo: undefined })
    )
    expect(r).toMatchObject({ score: null, band: 'full', bestLocus: null })
  })
})

describe('resolveLocus order', () => {
  it('HOXA13_1 strips the suffix and narrows the gene by coordinates', () => {
    const r = scoreStr(
      row({ chr: 'chr7', pos: 27199830, str_repeat_id: 'HOXA13_1', str_alt_copies: '30/15' }),
      REF,
      cs()
    )
    expect(r?.note.id).toBe('HOXA13_HFGS')
  })

  it('a gene with several loci and no overlap stays unresolved', () => {
    expect(scoreStr(row({ str_repeat_id: 'HOXA13_1' }), REF, cs())).toBeNull()
  })

  it('gene_symbol resolves a gene with exactly one locus', () => {
    const r = scoreStr(row({ gene_symbol: 'ATXN3', str_alt_copies: '72/24' }), REF, cs())
    expect(r?.note.id).toBe('ATXN3_SCA3')
  })

  it('falls back to coordinate overlap in both builds', () => {
    const r38 = row({ chr: 'chr14', pos: 92071020, str_alt_copies: '72/24' })
    const r37 = row({ chr: '14', pos: 92537360, str_alt_copies: '72/24' })
    expect(scoreStr(r38, REF, cs())?.note.id).toBe('ATXN3_SCA3')
    expect(scoreStr(r37, REF, cs({ build: 'GRCh37' }))?.note.id).toBe('ATXN3_SCA3')
    expect(scoreStr(r38, REF, cs({ build: 'GRCh37' }))).toBeNull()
  })

  it('an off-catalogue row gives null (every STR field null)', () => {
    expect(
      scoreStr(row({ str_repeat_id: 'EHDN_123', str_alt_copies: '90/20' }), REF, cs())
    ).toBeNull()
  })
})
