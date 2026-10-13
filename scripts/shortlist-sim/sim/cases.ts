/**
 * Simulated cases (spec §4.5, §11.3): per background, every plausible pool P/LP variant in a
 * background gene once as a single-allele case (AD/XLD het, AR hom), up to 3 compound-het pairs
 * per AR gene from alleles of the same disease, and 10 benign decoys per case. XLR is not
 * simulated (female backgrounds).
 */
import type { CaseMode, ConsequenceClass } from '../common/types'
import { rng, shuffle } from '../common/rng'
import type { PoolVariant } from '../pool/select-pool'
import type { BackgroundInfo } from './background-db'
import {
  spikeRow,
  type CaddSource,
  type SpikeOptions,
  type SpikeRow,
  type SpikeSource
} from './spikes'

export type { CaseMode }

export interface SimCase {
  id: string
  bg: string
  mode: CaseMode
  causal: SpikeRow[]
  decoys: SpikeRow[]
  gene: string
  consequenceClass: ConsequenceClass
  newSince2024: boolean
}

export interface CaseBackground {
  info: BackgroundInfo
  /** bcftools-normalised keys of the background's alleles (collision check). */
  normKeys: ReadonlySet<string>
}

export const DECOYS_PER_CASE = 10
export const COMPHET_PAIRS_PER_GENE = 3
export const MAX_POPMAX = { AD: 1e-4, AR: 1e-2, XLD: 1e-2, XLR: 1e-2, benign: 1e-2 } as const

const LOF = new Set([
  'stop_gained',
  'splice_acceptor_variant',
  'splice_donor_variant',
  'start_lost',
  'stop_lost'
])
const CLASS_ORDER: ConsequenceClass[] = ['lof', 'missense', 'inframe', 'other']

export function consequenceClassOf(func: string | null): ConsequenceClass {
  if (func === null) return 'other'
  if (LOF.has(func) || func.startsWith('frameshift')) return 'lof'
  if (func === 'missense_variant') return 'missense'
  if (func.startsWith('inframe')) return 'inframe'
  return 'other'
}

/** The more severe class (spec §11.2). */
const severest = (classes: ConsequenceClass[]): ConsequenceClass =>
  CLASS_ORDER[Math.min(...classes.map((c) => CLASS_ORDER.indexOf(c)))]

export function popmaxOf(src: SpikeSource): number | null {
  const g = src.ann.gnomad
  if (g === null) return null
  if (g.popmaxAf !== null) return g.popmaxAf
  const parts = [g.exomePopmaxAf, g.genomePopmaxAf].filter((x): x is number => x !== null)
  return parts.length > 0 ? Math.max(...parts) : null
}

export interface CaseBuild {
  cases: SimCase[]
  funnel: Record<string, number>
  caddSources: Record<CaddSource, number>
}

class Counter {
  readonly counts: Record<string, number> = {}
  add(key: string, n = 1): void {
    this.counts[key] = (this.counts[key] ?? 0) + n
  }
}

interface Ctx {
  bg: CaseBackground
  sources: Map<string, SpikeSource>
  opts: SpikeOptions
  rnd: () => number
  funnel: Counter
}

/** A plausible, annotated pool variant's spike in `bg`, or null (counted). */
function trySpike(
  ctx: Ctx,
  pv: PoolVariant,
  role: SpikeRow['role'],
  zyg: 'het' | 'hom',
  count: boolean
): SpikeRow | null {
  const src = ctx.sources.get(pv.key)
  const tally = (reason: string): null => {
    if (count) ctx.funnel.add(`${role}_${reason}`)
    return null
  }
  if (src === undefined) return tally('no_annotation')
  const popmax = popmaxOf(src)
  const limit = role === 'decoy' ? MAX_POPMAX.benign : MAX_POPMAX[pv.moi ?? 'AR']
  if (popmax !== null && popmax > limit) return tally('freq_implausible')
  const row = spikeRow(src, role, ctx.bg.info, ctx.bg.normKeys, zyg, ctx.rnd, ctx.opts)
  return typeof row === 'string' ? tally(row) : row
}

function singleCases(ctx: Ctx, plp: PoolVariant[]): Array<Omit<SimCase, 'decoys' | 'id'>> {
  const out: Array<Omit<SimCase, 'decoys' | 'id'>> = []
  for (const pv of plp) {
    if (pv.moi === 'XLR') {
      ctx.funnel.add('causal_xlr_not_simulated')
      continue
    }
    if (pv.moi === null) continue
    const mode: CaseMode = pv.moi === 'AR' ? 'AR_HOM' : pv.moi
    const spike = trySpike(ctx, pv, 'causal', mode === 'AR_HOM' ? 'hom' : 'het', true)
    if (spike === null) continue
    out.push({
      bg: ctx.bg.info.label,
      mode,
      causal: [spike],
      gene: pv.gene,
      consequenceClass: consequenceClassOf(spike.row.func),
      newSince2024: pv.newSince2024
    })
  }
  return out
}

function comphetCases(ctx: Ctx, plp: PoolVariant[]): Array<Omit<SimCase, 'decoys' | 'id'>> {
  const byGene = new Map<string, PoolVariant[]>()
  for (const pv of plp) {
    if (pv.moi === 'AR' && ctx.bg.info.genes.has(pv.gene))
      byGene.set(pv.gene, [...(byGene.get(pv.gene) ?? []), pv])
  }
  const out: Array<Omit<SimCase, 'decoys' | 'id'>> = []
  for (const gene of [...byGene.keys()].sort()) {
    const alleles = byGene.get(gene) ?? []
    const pairs: Array<[PoolVariant, PoolVariant]> = []
    for (let i = 0; i < alleles.length; i++)
      for (let j = i + 1; j < alleles.length; j++)
        if (alleles[i].diseaseIds.some((d) => alleles[j].diseaseIds.includes(d)))
          pairs.push([alleles[i], alleles[j]])
    let made = 0
    for (const [x, y] of shuffle(pairs, ctx.rnd)) {
      if (made >= COMPHET_PAIRS_PER_GENE) break
      const a = trySpike(ctx, x, 'causal', 'het', false)
      const b = trySpike(ctx, y, 'causal', 'het', false)
      if (a === null || b === null || a.key === b.key) continue
      made++
      out.push({
        bg: ctx.bg.info.label,
        mode: 'AR_COMPHET',
        causal: [a, b],
        gene,
        consequenceClass: severest([a, b].map((s) => consequenceClassOf(s.row.func))),
        newSince2024: x.newSince2024 || y.newSince2024
      })
    }
  }
  return out
}

/** Exactly 10 benign decoys from other background genes; throws if fewer exist. */
function addDecoys(ctx: Ctx, base: Omit<SimCase, 'decoys' | 'id'>, benign: PoolVariant[]): SimCase {
  const decoys: SpikeRow[] = []
  for (const pv of shuffle(benign, ctx.rnd)) {
    if (decoys.length === DECOYS_PER_CASE) break
    if (pv.gene === base.gene) continue
    const d = trySpike(ctx, pv, 'decoy', 'het', false)
    if (d !== null && !base.causal.some((c) => c.key === d.key)) decoys.push(d)
  }
  if (decoys.length < DECOYS_PER_CASE) throw new Error(`${base.bg}: fewer than 10 usable decoys`)
  const id = `${base.bg}|${base.mode}|${base.causal.map((c) => c.poolKey).join('+')}`
  return { ...base, id, decoys }
}

export function buildCases(
  pool: readonly PoolVariant[],
  sources: Map<string, SpikeSource>,
  bgs: readonly CaseBackground[],
  seed: number,
  opts: SpikeOptions
): CaseBuild {
  const funnel = new Counter()
  const cases: SimCase[] = []
  const plp = pool.filter((p) => p.label === 'plp')
  bgs.forEach((bg, i) => {
    const ctx: Ctx = { bg, sources, opts, rnd: rng(seed + 7919 * (i + 1)), funnel }
    const inGenes = plp.filter((p) => bg.info.genes.has(p.gene))
    funnel.add('causal_in_background_genes', inGenes.length)
    const benign = pool.filter((p) => p.label === 'benign' && bg.info.genes.has(p.gene))
    const singles = singleCases(ctx, inGenes)
    const pairs = comphetCases(ctx, inGenes)
    for (const base of [...singles, ...pairs]) cases.push(addDecoys(ctx, base, benign))
  })
  const caddSources: Record<CaddSource, number> = {
    'cadd-api': 0,
    'local-vep': 0,
    imputed: 0,
    none: 0
  }
  for (const c of cases) for (const s of [...c.causal, ...c.decoys]) caddSources[s.caddSource]++
  for (const m of ['AD', 'AR_HOM', 'AR_COMPHET', 'XLD'] as const)
    funnel.add(`cases_${m}`, cases.filter((c) => c.mode === m).length)
  return { cases, funnel: funnel.counts, caddSources }
}
