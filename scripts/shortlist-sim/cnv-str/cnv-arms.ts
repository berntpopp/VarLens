/**
 * Ablation arms of the CNV benchmark (spec §7.1, #642): A0 plain max-gene (the shipped gene
 * route), `region` the ClinGen region route alone, A3 the shipped `scoreCnv = max(S_gene, S_region)`,
 * and the SvAnna-style additive sum. Gene sets come from the interval fallback; sex and copy
 * number are unknown.
 */
import {
  cnvGeneSet,
  scoreCnv,
  type CnvGene,
  type CnvPhenotypeScorer,
  type CnvType,
  type GeneSpanLookup
} from '../../../src/shared/phenotype/cnv-score'
import type { LocusReference } from '../../../src/shared/types/locus-reference'

export const CNV_ARMS = ['A0', 'region', 'A3', 'sum'] as const
export type CnvArm = (typeof CNV_ARMS)[number]

export interface CnvInterval {
  chr: string
  start: number
  end: number
  type: CnvType
}

/** Profile-independent part of one CNV: its call and overlapped genes. */
export interface PreparedCnv {
  call: { chr: string; pos: number; end_pos: number; sv_type: string }
  genes: CnvGene[]
}

export interface ArmEnv {
  build: string
  reference: LocusReference
  /** The same reference without regions: A0 is `scoreCnv`'s gene route alone. */
  noRegions: LocusReference
}

export function armEnv(build: string, reference: LocusReference): ArmEnv {
  return { build, reference, noRegions: { ...reference, dosageRegions: [] } }
}

export function prepareCnv(c: CnvInterval, lookup: GeneSpanLookup): PreparedCnv {
  const genes = cnvGeneSet(undefined, lookup, c.chr, c.start, c.end)
  const call = { chr: c.chr, pos: c.start, end_pos: c.end, sv_type: c.type.toUpperCase() }
  return { call, genes }
}

/** Every arm's score (null: no indexed gene and no region) and n_c (indexed HPO genes). */
export function scoreArms(
  p: PreparedCnv,
  scorer: CnvPhenotypeScorer,
  env: ArmEnv
): { scores: Record<CnvArm, number | null>; n: number } {
  let sum: number | null = null
  let n = 0
  for (const g of p.genes) {
    const s = scorer.score(g.symbol)
    if (s === null) continue
    n++
    sum = (sum ?? 0) + Math.exp(s)
  }
  const ctx = { build: env.build, sex: null, scorer }
  const a0 = scoreCnv(p.call, p.genes, { ...ctx, reference: env.noRegions })?.score ?? null
  const region = scoreCnv(p.call, [], { ...ctx, reference: env.reference })?.score ?? null
  const a3 = scoreCnv(p.call, p.genes, { ...ctx, reference: env.reference })?.score ?? null
  return { scores: { A0: a0, region, A3: a3, sum }, n }
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
