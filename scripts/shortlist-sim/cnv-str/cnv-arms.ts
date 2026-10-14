/**
 * Ablation arms of the CNV benchmark (spec §7.1): A0 naive max-gene, A1 + dosage weights,
 * A2 + Šidák (the shipped gene route), A3 the shipped `scoreCnv`, and the SvAnna-style sum.
 * Gene sets come from the interval fallback; sex and copy number are unknown; no second hits.
 */
import {
  cnvGeneSet,
  dosageWeight,
  scoreCnv,
  type CnvGene,
  type CnvPhenotypeScorer,
  type CnvType,
  type GeneSpanLookup
} from '../../../src/shared/phenotype/cnv-score'
import type { LocusReference } from '../../../src/shared/types/locus-reference'

export const CNV_ARMS = ['A0', 'A1', 'A2', 'A3', 'sum'] as const
export type CnvArm = (typeof CNV_ARMS)[number]

export interface CnvInterval {
  chr: string
  start: number
  end: number
  type: CnvType
}

/** Profile-independent part of one CNV: its genes and their dosage weights. */
export interface PreparedCnv {
  call: { chr: string; pos: number; end_pos: number; sv_type: string }
  genes: CnvGene[]
  weights: number[]
}

export interface ArmEnv {
  build: string
  reference: LocusReference
  /** The same reference without regions: A2 is `scoreCnv`'s gene route alone. */
  noRegions: LocusReference
}

export function armEnv(build: string, reference: LocusReference): ArmEnv {
  return { build, reference, noRegions: { ...reference, dosageRegions: [] } }
}

export function prepareCnv(
  c: CnvInterval,
  lookup: GeneSpanLookup,
  ref: LocusReference
): PreparedCnv {
  const genes = cnvGeneSet(undefined, lookup, c.chr, c.start, c.end)
  const weights = genes.map((g) => {
    const curated = g.span && ref.dosageGenes.get(g.span.hgncId)
    const whole = g.span !== undefined && c.start <= g.span.start && g.span.end <= c.end
    return dosageWeight(c.type, curated ?? { hi: null, ts: null }, whole, false)
  })
  const call = { chr: c.chr, pos: c.start, end_pos: c.end, sv_type: c.type.toUpperCase() }
  return { call, genes, weights }
}

const NO_INFO = new Map()
const noHits = (): number => 0

/** Every arm's score (null: no indexed gene and no region) and n_c (indexed genes with w > 0). */
export function scoreArms(
  p: PreparedCnv,
  scorer: CnvPhenotypeScorer,
  env: ArmEnv
): { scores: Record<CnvArm, number | null>; n: number } {
  let a0: number | null = null
  let a1: number | null = null
  let sum: number | null = null
  let n = 0
  p.genes.forEach((g, i) => {
    const s = scorer.score(g.symbol)
    if (s === null) return
    a0 = Math.max(a0 ?? s, s)
    const w = p.weights[i]
    if (w <= 0) return
    n++
    a1 = Math.max(a1 ?? w * s, w * s)
    sum = (sum ?? 0) + w * Math.exp(s)
  })
  const ctx = { build: env.build, sex: null, scorer, hetHits: noHits }
  const a2 = scoreCnv(p.call, p.genes, NO_INFO, { ...ctx, reference: env.noRegions })?.score ?? null
  const a3 = scoreCnv(p.call, p.genes, NO_INFO, { ...ctx, reference: env.reference })?.score ?? null
  return { scores: { A0: a0, A1: a1, A2: a2, A3: a3, sum }, n }
}

/** Causal standing among background scores: nulls rank below every score and tie each other. */
export function standingAmong(
  causal: number | null,
  others: ArrayLike<number | null>
): { higher: number; equal: number } {
  const c = causal ?? -Infinity
  let higher = 0
  let equal = 0
  for (let i = 0; i < others.length; i++) {
    const o = others[i] ?? -Infinity
    if (o > c) higher++
    else if (o === c) equal++
  }
  return { higher, equal }
}
