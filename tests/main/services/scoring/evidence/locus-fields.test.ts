/**
 * CNV/STR locus fields in the whole-case context (CNV/STR spec §6.1, plan L5):
 * `hpo_resnik` is the locus score for CNV/STR rows, plus `hpo_best_locus`,
 * `cnv_gene_count`, `str_band` and the tooltip's locus note.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  GeneContextBuilder,
  type CaseInfo,
  type LightRow
} from '../../../../../src/main/services/scoring/evidence/case-context'
import type { LocusInputs } from '../../../../../src/main/services/scoring/evidence/locus-fields'
import {
  toLightRow,
  withHpoExplanations
} from '../../../../../src/main/services/scoring/evidence/rank-page'
import type { HpoGeneScorer } from '../../../../../src/main/services/phenotype/hpo-similarity-db'
import type { GeneSpan, GeneSpanLookup } from '../../../../../src/shared/phenotype/cnv-score'
import type { HpoExplanation } from '../../../../../src/shared/types/hpo-profile'
import type { LocusReference, StrLocus } from '../../../../../src/shared/types/locus-reference'
import type { ScoredCandidate } from '../../../../../src/shared/types/shortlist'

const GENE_SCORES: Record<string, number> = { GA: 0.9, GB: 0.8, GR: 0.7, SNVGENE: 0.5 }
const DISEASE_SCORES: Record<string, number> = { 'OMIM:109150': 0.75 }

const explanation = (diseaseId: string, score: number): HpoExplanation => ({
  score,
  percentile: 0.5,
  diseaseId,
  diseaseLabel: diseaseId,
  matched: [],
  conflicts: [],
  notConflicts: []
})

function scorer(): HpoGeneScorer {
  return {
    score: (g) => GENE_SCORES[g] ?? null,
    bestDisease: (g) => (g in GENE_SCORES ? `OMIM:${g}` : null),
    conflicts: (g) => (g in GENE_SCORES ? 0 : null),
    explain: (g) => explanation(`OMIM:${g}`, GENE_SCORES[g]),
    scoreDiseases(ids) {
      let best: { score: number; disease: string } | null = null
      for (const id of ids) {
        const s = DISEASE_SCORES[id]
        if (s !== undefined && (best === null || s > best.score)) best = { score: s, disease: id }
      }
      return best
    },
    explainDisease: vi.fn((id: string, score?: number) => explanation(id, score ?? 0))
  }
}

const span = (symbol: string, start: number, end: number, n: number, coding = true): GeneSpan => ({
  chr: '15',
  start,
  end,
  symbol,
  hgncId: `HGNC:${n}`,
  coding
})
const SPANS = [
  span('GA', 1_000, 2_000, 1),
  span('GB', 3_000, 4_000, 2),
  span('GNC', 5_000, 6_000, 3, false),
  span('GR', 20_000, 30_000, 4)
]
const GENES: GeneSpanLookup = {
  overlapping: (chr, a, b) => SPANS.filter((s) => chr.endsWith('15') && s.end >= a && s.start <= b),
  span: (symbol) => SPANS.find((s) => s.symbol === symbol)
}

const ATXN3: StrLocus = {
  id: 'SCA3_ATXN3',
  gene: 'ATXN3',
  chrom: 'chr14',
  hg19: null,
  hg38: { start: 92_071_010, stop: 92_071_042 },
  pathogenicMotifs: ['CAG'],
  benignMax: 44,
  intermediateMin: null,
  intermediateMax: null,
  pathogenicMin: 60,
  inheritance: ['AD'],
  evidence: 'Definitive',
  onsetMin: 20,
  onsetMax: 50,
  diseases: { full: ['OMIM:109150'] }
}
const REFERENCE: LocusReference = {
  dosageGenes: new Map([
    ['HGNC:2', { hgncId: 'HGNC:2', symbol: 'GB', hi: 3, ts: 1 }],
    ['HGNC:4', { hgncId: 'HGNC:4', symbol: 'GR', hi: 30, ts: null }]
  ]),
  dosageRegions: [],
  strLoci: [ATXN3],
  sources: { clingen: '2026-10-14' }
}

const row = (id: number, o: Partial<LightRow>): LightRow => ({
  id,
  chr: 'chr15',
  pos: 500,
  ref: 'N',
  alt: '<DEL>',
  gene_symbol: 'GA',
  gt_num: '0/1',
  ...o
})
const cnv = (id: number, o: Partial<LightRow> = {}): LightRow =>
  row(id, { variant_type: 'cnv', sv_type: 'DEL', end_pos: 4_500, cnv_copy_number: 1, ...o })
const str = (id: number, o: Partial<LightRow> = {}): LightRow =>
  row(id, {
    variant_type: 'str',
    chr: 'chr14',
    pos: 92_071_010,
    ref: 'C',
    alt: '<STR72>',
    gene_symbol: 'ATXN3',
    str_alt_copies: '72',
    str_status: 'full_mutation',
    str_repeat_id: 'ATXN3',
    str_repeat_unit: 'CTG',
    ...o
  })

const inputs = (o: Partial<LocusInputs> = {}): LocusInputs => ({
  reference: REFERENCE,
  genes: GENES,
  cnvGenes: new Map([[1, ['GA', 'GB', 'GNC']]]),
  ...o
})

function context(rows: LightRow[], info: Partial<CaseInfo> = {}, locus = inputs()) {
  const builder = new GeneContextBuilder({ build: 'GRCh38', sex: 'female', ...info })
  builder.add(rows)
  return { builder, ctx: builder.build(builder.needsLocus ? locus : undefined) }
}

describe('CNV locus fields', () => {
  it('scores the CSQ gene set with plain best gene and names the best gene', () => {
    const r = cnv(1)
    const d = context([r], { hpo: scorer() }).ctx.derived(r)
    // GA (0.9) beats GB (0.8) on plain best-gene scoring.
    expect(d).toMatchObject({
      hpo_resnik: 0.9,
      hpo_best_disease: 'OMIM:GA',
      hpo_conflicts: 0,
      hpo_best_locus: 'GA',
      cnv_gene_count: 2,
      str_band: null
    })
  })

  it('keeps cnv_gene_count without HPO terms and falls back to the interval overlap', () => {
    const r = cnv(2, { pos: 900, end_pos: 5_500 })
    const d = context([r]).ctx.derived(r)
    expect(d).toMatchObject({ hpo_resnik: null, hpo_best_locus: null, cnv_gene_count: 2 })
  })

  it('scores a single-gene CNV with its unpenalized gene score', () => {
    const del = cnv(3, { pos: 19_000, end_pos: 31_000, gene_symbol: 'GR' })
    const alone = context([del], { hpo: scorer() }, inputs({ cnvGenes: new Map() }))
    expect(alone.ctx.derived(del).hpo_resnik).toBeCloseTo(0.7)
  })

  it('explains the locus score with the note on the kept row', () => {
    const r = cnv(1)
    const hpo = scorer()
    const { ctx } = context([r], { hpo })
    const [kept] = withHpoExplanations([r as unknown as ScoredCandidate], ctx)
    expect(hpo.explainDisease).toHaveBeenCalledWith('OMIM:GA', 0.9)
    expect(kept.rank_hpo).toMatchObject({
      score: 0.9,
      locus: {
        kind: 'gene',
        id: 'GA',
        label: 'GA',
        diseaseGenes: 2,
        genes: 2
      }
    })
  })
  it('without gene_reference.db only the CSQ genes count; an unscored CNV has no explanation', () => {
    const r = cnv(5, { pos: 900, end_pos: 5_500 })
    const { ctx } = context([r], { hpo: scorer() }, inputs({ genes: null, cnvGenes: new Map() }))
    expect(ctx.derived(r)).toMatchObject({ hpo_resnik: null, hpo_best_locus: null })
    const [kept] = withHpoExplanations([r as unknown as ScoredCandidate], ctx)
    expect(kept.rank_hpo ?? null).toBeNull()
  })
})

describe('STR locus fields', () => {
  it('scores the catalogue locus diseases and sets the band', () => {
    const r = str(10)
    const { ctx } = context([r], { hpo: scorer() })
    expect(ctx.derived(r)).toMatchObject({
      hpo_resnik: 0.75,
      hpo_best_disease: 'OMIM:109150',
      hpo_best_locus: 'SCA3_ATXN3',
      str_band: 'full',
      cnv_gene_count: null
    })
    const [kept] = withHpoExplanations([r as unknown as ScoredCandidate], ctx)
    expect(kept.rank_hpo?.locus).toMatchObject({ kind: 'str', id: 'SCA3_ATXN3', band: 'full' })
  })

  it('sets the band without HPO terms, and from Stranger without the catalogue', () => {
    const r = str(11)
    expect(context([r]).ctx.derived(r)).toMatchObject({ hpo_resnik: null, str_band: 'full' })
    const noRef = context([r], {}, inputs({ reference: null })).ctx.derived(r)
    expect(noRef).toMatchObject({ hpo_resnik: null, str_band: 'full' })
    // Per-allele Stranger status: the highest band wins.
    const mixed = str(17, { str_status: 'normal,pre_mutation' })
    expect(context([mixed], {}, inputs({ reference: null })).ctx.derived(mixed).str_band).toBe(
      'premutation'
    )
    expect(
      context([r], {}, inputs()).ctx.derived(
        str(12, { str_repeat_id: null, chr: '1', gene_symbol: null })
      )
    ).toMatchObject({ str_band: null })
  })

  it('a normal-length STR never counts as an allele of its gene', () => {
    const normal = str(13, { str_alt_copies: '20/24', str_status: 'normal' })
    const snv = row(14, { chr: 'chr14', pos: 92_000_000, ref: 'A', alt: 'G', gene_symbol: 'ATXN3' })
    const { ctx } = context([normal, snv])
    expect(ctx.hetHits('ATXN3')).toBe(1)
    expect(ctx.derived(snv)).toMatchObject({ gene_het_hits: 1, partners: [] })
  })

  it('an expanded STR pairs with an SNV in its gene, but is not its own second hit', () => {
    // FXN GAA expansion + FXN missense (Friedreich ataxia), on an AR locus.
    const ar = { ...REFERENCE, strLoci: [{ ...ATXN3, inheritance: ['AR'] }] }
    const expansion = str(15)
    const snv = row(16, { chr: 'chr14', pos: 92_000_000, ref: 'A', alt: 'G', gene_symbol: 'ATXN3' })
    const alone = context([expansion], { hpo: scorer() }, inputs({ reference: ar }))
    expect(alone.ctx.hetHits('ATXN3')).toBe(1)
    expect(alone.ctx.derived(expansion).hpo_resnik).toBeNull()
    const pair = context([expansion, snv], { hpo: scorer() }, inputs({ reference: ar }))
    expect(pair.ctx.derived(snv)).toMatchObject({ gene_het_hits: 2, partners: [15] })
    expect(pair.ctx.derived(expansion)).toMatchObject({ hpo_resnik: 0.75, partners: [16] })
  })
})

describe('SNV rows', () => {
  it('hpo_best_locus is the gene, null like hpo_resnik; locus loads are skipped', () => {
    const snv = row(20, { chr: '1', ref: 'A', alt: 'G', gene_symbol: 'SNVGENE' })
    const { builder, ctx } = context([snv], { hpo: scorer() })
    expect(builder.needsLocus).toBe(false)
    expect(ctx.derived(snv)).toMatchObject({
      hpo_resnik: 0.5,
      hpo_best_locus: 'SNVGENE',
      cnv_gene_count: null,
      str_band: null
    })
    expect(context([snv]).ctx.derived(snv).hpo_best_locus).toBeNull()
  })

  it('toLightRow copies the locus fields only for CNV and STR rows', () => {
    const extra = { variant_type: 'snv', sv_type: 'DEL' }
    expect(toLightRow(row(21, extra))).not.toHaveProperty('sv_type')
    expect(toLightRow(cnv(22))).toMatchObject({
      sv_type: 'DEL'
    })
  })
})
