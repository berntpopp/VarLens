/**
 * Aggregate-only concordance metrics (spec §4.4, §11.4). Inputs may be patient-derived; the
 * returned report holds only counts, errors and correlations — no coordinates, genes or rows.
 */
import type { LocalVepRecord } from '../annotate/local-vep'
import {
  alleleClass,
  projectToVarvis,
  vepTermKey,
  type AlleleClass,
  type FuncMappingRow,
  type ImpactRow
} from '../annotate/project-varvis'
import type { SpikeAnnotation } from '../annotate/spike-annotation'
import type { MappedVariant } from './load-backgrounds'

export const AF_FIELDS = [
  'joint',
  'exome',
  'genome',
  'popmax',
  'exome_popmax',
  'genome_popmax'
] as const
export type AfField = (typeof AF_FIELDS)[number]

/** Frozen acceptance tolerances (spec §11.4). */
export const TOLERANCE = {
  afMedianLog10: 0.1,
  caddMedianAbs: 0.5,
  caddPearson: 0.98,
  unmappedShare: 0.05
}
const MIN_AF_SITES = 100
/** Minimum compared sites for an acceptance verdict. */
export const MIN_EVAL = 200

export interface Verdict {
  pass: boolean | null
  reason: string
}

export function verdict(n: number, ok: boolean): Verdict {
  if (n < MIN_EVAL) return { pass: null, reason: `not evaluable: n = ${n} < ${MIN_EVAL}` }
  return { pass: ok, reason: `${ok ? 'pass' : 'fail'} (n = ${n})` }
}

export interface AfStat {
  field: AfField
  medianAbsLog10Err: number | null
  n: number
  onlyVarvis: number
  onlyLocal: number
  bothMissing: number
}
export interface CaddStat {
  n: number
  medianAbsErr: number | null
  pearson: number | null
}

export interface ConcordanceReport {
  generatedAt: string
  backgrounds: Array<{
    label: string
    rows: number
    skipped: number
    sites: number
    matched: number
  }>
  sites: number
  matched: number
  normalization: Record<string, number>
  /** Transcript choice per matched site: 'gene' (varvis gene), 'pick' (no gene), 'unmapped_gene'. */
  transcriptSelection: Record<string, number>
  funcMapping: FuncMappingRow[]
  impactByFunc: ImpactRow[]
  funcAgreement: { n: number; projectedEqual: number; impactEqual: number; unmapped: number }
  afField: AfStat[]
  cadd: CaddStat
  missingness: Array<{ field: string; varvisMissing: number; localMissing: number; n: number }>
  geneConstancy: Array<{ field: string; genes: number; inconsistentGenes: number }>
  pool: {
    /** pool variants with both genefoundry and local annotation; vepPairs: of those with genefoundry VEP */
    n: number
    vepPairs: number
    afField: AfStat[]
    cadd: CaddStat
    termAgreement: number
    transcriptAgreement: number
    unmapped: number
    unmappedShare: number
    byReason: Record<string, number>
  } | null
  acceptance: {
    afField: AfField | null
    /** null = not evaluable (fewer than MIN_EVAL compared sites), never a fail. */
    afPass: boolean | null
    caddPass: boolean | null
    poolAfPass: boolean | null
    poolCaddPass: boolean | null
    reasons: Record<'af' | 'cadd' | 'poolAf' | 'poolCadd', string>
    unmappedShare: number | null
    unmappedFlag: boolean
  }
}

export interface Site {
  varvis: MappedVariant
  local: LocalVepRecord | null
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

const pos = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null

export function afStat(
  field: AfField,
  pairs: Array<[number | null | undefined, number | null | undefined]>
): AfStat {
  const errs: number[] = []
  let onlyVarvis = 0
  let onlyLocal = 0
  let bothMissing = 0
  for (const [a, b] of pairs) {
    const x = pos(a)
    const y = pos(b)
    if (x !== null && y !== null) errs.push(Math.abs(Math.log10(x) - Math.log10(y)))
    else if (x !== null) onlyVarvis++
    else if (y !== null) onlyLocal++
    else bothMissing++
  }
  return {
    field,
    medianAbsLog10Err: median(errs),
    n: errs.length,
    onlyVarvis,
    onlyLocal,
    bothMissing
  }
}

export function caddStat(
  pairs: Array<[number | null | undefined, number | null | undefined]>
): CaddStat {
  const both = pairs.filter(
    (p): p is [number, number] => typeof p[0] === 'number' && typeof p[1] === 'number'
  )
  return {
    n: both.length,
    medianAbsErr: median(both.map(([a, b]) => Math.abs(a - b))),
    pearson: pearson(
      both.map((p) => p[0]),
      both.map((p) => p[1])
    )
  }
}

export function localAf(r: LocalVepRecord, field: AfField): number | null {
  const m: Record<AfField, number | null> = {
    joint: r.gnomadJointAf,
    exome: r.gnomadExomeAf,
    genome: r.gnomadGenomeAf,
    popmax: r.popmaxAf,
    exome_popmax: r.exomePopmaxAf,
    genome_popmax: r.genomePopmaxAf
  }
  return m[field]
}

export function spikeAf(a: SpikeAnnotation, field: AfField): number | null {
  const g = a.gnomad
  if (g === null) return null
  const m: Record<AfField, number | null> = {
    joint: g.jointAf,
    exome: g.exomeAf,
    genome: g.genomeAf,
    popmax: g.popmaxAf,
    exome_popmax: g.exomePopmaxAf,
    genome_popmax: g.genomePopmaxAf
  }
  return m[field]
}

/** Smallest median log10 error among fields with enough sites. */
export function chooseAfField(stats: AfStat[]): AfField | null {
  const ok = stats.filter((s) => s.medianAbsLog10Err !== null && s.n >= MIN_AF_SITES)
  ok.sort((a, b) => a.medianAbsLog10Err! - b.medianAbsLog10Err!)
  return ok[0]?.field ?? null
}

function countRows<K extends string>(keys: Iterable<K>): Map<K, number> {
  const m = new Map<K, number>()
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
  return m
}

/** Sites with a usable consequence: annotated and not `unmapped_gene` (gene has no transcript). */
const hasTerms = (s: Site): boolean => s.local !== null && s.local.selection !== 'unmapped_gene'

export function buildFuncMapping(sites: Site[]): FuncMappingRow[] {
  const counts = countRows(
    sites
      .filter((s) => hasTerms(s) && s.varvis.func !== null)
      .map((s) => {
        const cls: AlleleClass = alleleClass(s.varvis.ref, s.varvis.alt)
        return [vepTermKey(s.local!.mostSevere, s.local!.terms), cls, s.varvis.func].join('\t')
      })
  )
  return [...counts.entries()]
    .map(([k, count]) => {
      const [vepTerm, cls, varvisFunc] = k.split('\t')
      return { vepTerm, alleleClass: cls as AlleleClass, varvisFunc, count }
    })
    .sort((a, b) => b.count - a.count || a.vepTerm.localeCompare(b.vepTerm))
}

export function buildImpactByFunc(rows: MappedVariant[]): ImpactRow[] {
  const counts = countRows(
    rows.filter((r) => r.func !== null).map((r) => `${r.func}\t${r.consequence ?? 'null'}`)
  )
  return [...counts.entries()]
    .map(([k, count]) => {
      const [varvisFunc, impact] = k.split('\t')
      return { varvisFunc, impact, count }
    })
    .sort((a, b) => b.count - a.count)
}

/** Per background: genes whose gene-level fields take more than one value. */
export function geneConstancy(
  backgrounds: Array<{ rows: MappedVariant[] }>
): ConcordanceReport['geneConstancy'] {
  const fields = ['hpo_sim_score', 'moi', 'omim_mim_number'] as const
  return fields.map((field) => {
    let genes = 0
    let inconsistent = 0
    for (const bg of backgrounds) {
      const values = new Map<string, Set<string>>()
      for (const r of bg.rows) {
        if (r.gene_symbol === null) continue
        const set = values.get(r.gene_symbol) ?? new Set<string>()
        set.add(String(r[field]))
        values.set(r.gene_symbol, set)
      }
      genes += values.size
      inconsistent += [...values.values()].filter((s) => s.size > 1).length
    }
    return { field, genes, inconsistentGenes: inconsistent }
  })
}

export function funcAgreement(
  sites: Site[],
  mapping: FuncMappingRow[],
  impactByFunc: ImpactRow[]
): ConcordanceReport['funcAgreement'] {
  let n = 0
  let projectedEqual = 0
  let impactEqual = 0
  let unmapped = 0
  for (const s of sites) {
    if (!hasTerms(s) || s.varvis.func === null) continue
    n++
    const p = projectToVarvis(s.local!.mostSevere, s.local!.terms, mapping, impactByFunc, s.varvis)
    if (p.reason === 'unmapped') unmapped++
    if (p.func === s.varvis.func) projectedEqual++
    if (p.consequence !== null && p.consequence === s.varvis.consequence) impactEqual++
  }
  return { n, projectedEqual, impactEqual, unmapped }
}
