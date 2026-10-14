/**
 * Naive reference for phenotype scoring v2 (spec §3): explicit ancestor sets,
 * pairwise MICA, per-disease loops. Mirrors the documented conventions of the
 * fast scorer: float32 IC / frequencies, IC(t) = sim(t, t), first maximum wins.
 */
import { HPO_SCORING_CONFIG as C } from '../../../src/shared/config/hpo-scoring.config'
import type { PhenotypeIndexInput } from '../../../src/shared/phenotype/phenotype-index'
import type { HpoProfileTerm } from '../../../src/shared/types/hpo-profile'
import type { HpoScoringOptions } from '../../../src/shared/config/hpo-scoring.config'

const ROOT = 'HP:0000118'
const f32 = Math.fround

export interface NaiveGene {
  score: number
  /** every disease's score, to compare argmax only when it is unambiguous */
  diseases: Array<{ id: string; score: number }>
  best: string
  matched: Set<string>
  conflicts: Set<string>
}

export function naiveScores(
  input: PhenotypeIndexInput,
  terms: readonly HpoProfileTerm[],
  opts: HpoScoringOptions
): Map<string, NaiveGene> | null {
  const parents = new Map<string, string[]>()
  for (const [c, p] of input.edges) parents.set(c, [...(parents.get(c) ?? []), p])
  const ic = new Map(input.terms.map((t) => [t.id, f32(t.ic)]))
  const alias = new Map(input.aliases)
  const ancCache = new Map<string, Set<string>>()
  const anc = (t: string): Set<string> => {
    let out = ancCache.get(t)
    if (out !== undefined) return out
    out = new Set([t])
    for (const p of parents.get(t) ?? []) for (const a of anc(p)) out.add(a)
    ancCache.set(t, out)
    return out
  }
  const self = (t: string): number => Math.max(0, ...[...anc(t)].map((a) => ic.get(a)!))
  const sim = (a: string, b: string): number => {
    const bAnc = anc(b)
    return Math.max(0, ...[...anc(a)].filter((x) => bAnc.has(x)).map((x) => ic.get(x)!))
  }
  const systemsOf = (t: string): string[] =>
    [...anc(t)].filter((a) => (parents.get(a) ?? []).includes(ROOT))

  // Profile preprocessing.
  const presentKey = new Map<string, boolean>()
  const excludedRaw = new Set<string>()
  for (const term of terms) {
    const t = alias.get(term.hpoId) ?? term.hpoId
    if (!ic.has(t) || self(t) === 0) continue
    if (term.excluded) excludedRaw.add(t)
    else presentKey.set(t, presentKey.get(t) === true || term.key)
  }
  const all = [...presentKey.keys()]
  if (all.length === 0) return null
  const present = all
    .filter((q) => !all.some((r) => r !== q && anc(r).has(q)))
    .map((q) => {
      const ups = all.filter((p) => anc(q).has(p))
      const key = ups.some((p) => presentKey.get(p) === true)
      return { term: q, key, w: key ? C.keyWeight : 1 }
    })
  const ancP = new Set(all.flatMap((p) => [...anc(p)]))
  const excluded = [...excludedRaw].filter((e) => !ancP.has(e))

  // Diseases (sorted by id: the first maximum wins).
  const ann = new Map<
    string,
    Array<{ t: string; f: number; fx: number; fac: number; known: boolean }>
  >()
  for (const [d, t, f, fx] of input.diseaseTerms) {
    if (!ic.has(t) || self(t) === 0) continue
    const list = ann.get(d) ?? []
    const known = !(f32(f) === f32(C.missing.f) && f32(fx) === f32(C.missing.fExcl))
    list.push({ t, f: f32(f), fx: f32(fx), fac: f32(1 - C.alphaF + C.alphaF * f32(f)), known })
    ann.set(d, list)
  }
  const nots0 = new Map<string, string[]>()
  for (const [d, t] of input.diseaseNot) if (ic.has(t)) nots0.set(d, [...(nots0.get(d) ?? []), t])

  const zMode = opts.correction === 'z'
  const fw = present.map((p) => p.w * Math.pow(self(p.term), opts.tau))
  const fwSum = fw.reduce((a, b) => a + b, 0)
  const diseaseIds = input.diseases.map(([id]) => id)
  const K = C.nullMaxK
  const nullOf = new Map(input.diseaseNull?.map(([d, mu, sd]) => [d, { mu, sd }]) ?? [])
  const muAt = (d: string, col: number): number => nullOf.get(d)?.mu[col] ?? 0
  const sdAt = (d: string, col: number): number => nullOf.get(d)?.sd[col] ?? 0
  const w1 = present.reduce((a, p) => a + p.w, 0)
  const w2 = present.reduce((a, p) => a + p.w * p.w, 0)
  const kEff = Math.min(K, Math.max(1, (w1 * w1) / w2))
  const lo = Math.floor(kEff) - 1
  const hi = Math.min(lo + 1, K - 1)
  const frac = kEff - (lo + 1)
  const interp = (get: (col: number) => number): number => get(lo) + frac * (get(hi) - get(lo))
  const floorAt = (col: number): number => {
    const sds = diseaseIds.map((d) => sdAt(d, col)).sort((a, b) => a - b)
    return sds[Math.floor(C.sigmaFloorQuantile * (sds.length - 1))]
  }
  const sigmaFloor = Math.max(C.sigmaMin, interp(floorAt))
  // b_e: mean over diseases of the max point frequency of the disease's annotations at or below e.
  const background = (e: string): number =>
    diseaseIds
      .map((d) => Math.max(0, ...(ann.get(d) ?? []).filter((a) => anc(a.t).has(e)).map((a) => a.f)))
      .reduce((x, y) => x + y, 0) / diseaseIds.length
  const lr = (f: number, b: number): number => {
    const eps = opts.lrEpsilon
    return Math.max(0, -Math.log(((1 - eps) * (1 - f) + eps) / ((1 - eps) * (1 - b) + eps)))
  }
  const exclFreq = (a: { f: number; fx: number }): number => (zMode ? a.f : a.fx)

  const diseaseScore = (d: string): number => {
    const list = ann.get(d) ?? []
    let fwd = 0
    present.forEach((p, i) => {
      const m = Math.max(0, ...list.map((a) => sim(p.term, a.t) * a.fac))
      fwd += (fw[i] * m) / self(p.term)
    })
    fwd /= fwSum
    let num = 0
    let den = C.f0
    for (const a of list) {
      num += (a.f * Math.max(...present.map((p) => sim(p.term, a.t)))) / self(a.t)
      den += a.f
    }
    const sysMax = new Map<string, number>()
    for (const e of excluded) {
      const gated = (a: (typeof list)[number]): boolean =>
        opts.exclusionMode === 'penalty' &&
        (opts.excludeMinFrequency === 0 || (a.known && a.f >= opts.excludeMinFrequency))
      const c = Math.max(0, ...list.filter((a) => anc(a.t).has(e) && gated(a)).map(exclFreq))
      if (c <= 0) continue
      const v = zMode ? lr(c, background(e)) : c
      for (const s of systemsOf(e)) sysMax.set(s, Math.max(sysMax.get(s) ?? 0, v))
    }
    const excl = [...sysMax.values()].reduce((a, b) => a + b, 0)
    const nots =
      opts.exclusionMode === 'penalty' ? (nots0.get(d) ?? []).filter((n) => ancP.has(n)).length : 0
    const plus = C.gamma * fwd + (1 - C.gamma) * (num / den)
    if (opts.correction === 'off') {
      return plus * Math.exp(-C.lambda * Math.min(C.eMax, excl + nots))
    }
    const mu = interp((col) => muAt(d, col))
    if (zMode) {
      const sd = interp((col) => sdAt(d, col))
      const load = Math.min(C.lrCap, excl + nots * C.lrCap)
      return (plus - mu) / Math.max(sd, sigmaFloor) - opts.lambdaZ * load
    }
    const corrected = mu < 1 ? Math.max(0, (plus - mu) / (1 - mu)) : 0
    return corrected * Math.exp(-C.lambda * Math.min(C.eMax, excl + nots))
  }

  const genes = new Map<string, string[]>()
  for (const [g, d] of input.geneDiseases) {
    if (!(genes.get(g) ?? []).includes(d)) genes.set(g, [...(genes.get(g) ?? []), d])
  }
  const out = new Map<string, NaiveGene>()
  for (const [gene, ds] of genes) {
    const diseases = ds
      .filter((d) => input.diseases.some(([id]) => id === d))
      .sort()
      .map((id) => ({ id, score: diseaseScore(id) }))
    if (diseases.length === 0) continue
    let best = diseases[0]
    for (const d of diseases) if (d.score > best.score) best = d
    const score = zMode
      ? 1 /
        (1 +
          Math.exp(
            -(best.score - opts.geneMaxPenalty * Math.sqrt(2 * Math.log(diseases.length))) / 2
          ))
      : best.score
    const list = ann.get(best.id) ?? []
    const matched = new Set<string>()
    for (const p of present) {
      let top = 0
      let arg: string | null = null
      for (const a of list) {
        const v = sim(p.term, a.t) * a.fac
        if (v > top) [top, arg] = [v, a.t]
      }
      if (arg !== null && top / self(p.term) >= C.explainMinMatch) {
        matched.add(`${p.term}>${arg}${p.key ? '*' : ''}`)
      }
    }
    const conflicts = new Set<string>()
    for (const e of excluded) {
      let top = 0
      let arg: string | null = null
      for (const a of list)
        if (anc(a.t).has(e) && exclFreq(a) > top) [top, arg] = [exclFreq(a), a.t]
      if (arg !== null) conflicts.add(`${e}>${arg}`)
    }
    out.set(gene, { score, diseases, best: best.id, matched, conflicts })
  }
  return out
}
