// Case-level and aggregate ranking metrics (spec §5.1, §11.2).
import type { AlleleRank, CaseResult } from '../common/types'

/** Production case rank: worst causal allele rank; null if any allele is absent. */
export function caseRank(ranks: Array<number | null>): number | null {
  if (ranks.length === 0) return null
  let worst = 0
  for (const r of ranks) {
    if (r === null) return null
    worst = Math.max(worst, r)
  }
  return worst
}

/** 1 when every causal allele is ranked ≤ k (compound het needs both); a null rank is a miss. */
export function hitAtK(ranks: Array<number | null>, k: number): 0 | 1 {
  const r = caseRank(ranks)
  return r !== null && r <= k ? 1 : 0
}

/**
 * Tie-averaged hit: rank = higher + U, U uniform on 1..equal+1 (the allele and its
 * `equal` tied peers in random order). P(rank ≤ k) = clamp(k − higher, 0, m) / m, m = equal+1.
 */
export function tieAveragedHit(higher: number, equal: number, k: number): number {
  return tieGroupCdf([{ rank: 0, higher, equal }], k)
}

/** E[1/rank] for rank = higher + U, U uniform on 1..equal+1: (1/m) Σ_{r=higher+1}^{higher+m} 1/r. */
export function tieAveragedReciprocal(higher: number, equal: number): number {
  return caseTieReciprocal([{ rank: 0, higher, equal }])
}

type TieGroups = Array<{ higher: number; m: number; n: number }>

/** Alleles sharing `higher` share one tie group (same partition and score). */
function tieGroups(alleles: AlleleRank[]): TieGroups {
  const groups = new Map<number, { higher: number; m: number; n: number }>()
  for (const a of alleles) {
    const g = groups.get(a.higher)
    if (g) g.n += 1
    else groups.set(a.higher, { higher: a.higher, m: a.equal + 1, n: 1 })
  }
  return [...groups.values()]
}

/**
 * CDF of the case rank (max over alleles) under independent uniform tie orders:
 * n alleles in a group of size m all lie within its first j positions with probability
 * Π_{i<n} (j−i)/(m−i); different groups are independent, so their CDFs multiply.
 */
function groupsCdf(groups: TieGroups, r: number): number {
  let p = 1
  for (const { higher, m, n } of groups) {
    const j = Math.min(Math.max(r - higher, 0), m)
    for (let i = 0; i < n; i++) p *= Math.max(j - i, 0) / (m - i)
    if (p === 0) return 0
  }
  return p
}

const tieGroupCdf = (alleles: AlleleRank[], r: number): number => groupsCdf(tieGroups(alleles), r)

const harmonicCache: number[] = [0]
/** H(n) = Σ_{i=1}^{n} 1/i, cached. */
function harmonic(n: number): number {
  for (let i = harmonicCache.length; i <= n; i++) harmonicCache.push(harmonicCache[i - 1] + 1 / i)
  return harmonicCache[n]
}

/** Tie-averaged P(case rank ≤ k); any absent allele → 0. */
export function caseTieHit(alleles: AlleleRank[], k: number): number {
  if (alleles.length === 0 || alleles.some((a) => a.rank === null)) return 0
  return tieGroupCdf(alleles, k)
}

/** Tie-averaged E[1/case rank] = Σ_r (F(r) − F(r−1)) / r; any absent allele → 0. */
export function caseTieReciprocal(alleles: AlleleRank[]): number {
  if (alleles.length === 0 || alleles.some((a) => a.rank === null)) return 0
  if (alleles.length === 1) {
    const { higher, equal } = alleles[0]
    return (harmonic(higher + equal + 1) - harmonic(higher)) / (equal + 1)
  }
  const groups = tieGroups(alleles)
  const lo = Math.min(...groups.map((g) => g.higher)) + 1
  const hi = Math.max(...groups.map((g) => g.higher + g.m))
  let prev = groupsCdf(groups, lo - 1)
  let sum = 0
  for (let r = lo; r <= hi; r++) {
    const f = groupsCdf(groups, r)
    sum += (f - prev) / r
    prev = f
  }
  return sum
}

const ranksOf = (c: CaseResult): Array<number | null> => c.alleles.map((a) => a.rank)

export const mean = (xs: number[]): number =>
  xs.length === 0 ? Number.NaN : xs.reduce((s, x) => s + x, 0) / xs.length

/** Median; +∞ entries allowed (null ranks are passed as Infinity). */
export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  if (s.length % 2 === 1) return s[mid]
  const lo = s[mid - 1]
  const hi = s[mid]
  return lo === hi ? lo : (lo + hi) / 2
}

export const caseHit =
  (k: number) =>
  (c: CaseResult): number =>
    hitAtK(ranksOf(c), k)

export const caseReciprocal = (c: CaseResult): number => {
  const r = caseRank(ranksOf(c))
  return r === null ? 0 : 1 / r
}

export const meanHitAtK = (cases: CaseResult[], k: number): number => mean(cases.map(caseHit(k)))
export const mrr = (cases: CaseResult[]): number => mean(cases.map(caseReciprocal))
export const medianRank = (cases: CaseResult[]): number =>
  median(cases.map((c) => caseRank(ranksOf(c)) ?? Number.POSITIVE_INFINITY))

/** Share of cases with case rank ≤ k, for each k. */
export function rankCdf(cases: CaseResult[], ks: number[]): Array<{ k: number; share: number }> {
  return ks.map((k) => ({ k, share: meanHitAtK(cases, k) }))
}

/** Mean over consequence classes of the within-class mean (spec §5.1); empty classes are skipped. */
export function macroAverage(
  cases: CaseResult[],
  metric: (c: CaseResult) => number,
  classOf: (c: CaseResult) => string = (c) => c.consequenceClass
): number {
  const byClass = new Map<string, { sum: number; n: number }>()
  for (const c of cases) {
    const key = classOf(c)
    const acc = byClass.get(key) ?? { sum: 0, n: 0 }
    acc.sum += metric(c)
    acc.n += 1
    byClass.set(key, acc)
  }
  if (byClass.size === 0) return Number.NaN
  let total = 0
  for (const { sum, n } of byClass.values()) total += sum / n
  return total / byClass.size
}

/** Mean decoys in the top 10, and share of cases with at least one. */
export function decoyIntrusion(cases: CaseResult[]): { mean: number; shareAny: number } {
  return {
    mean: mean(cases.map((c) => c.decoysTop10)),
    shareAny: mean(cases.map((c) => (c.decoysTop10 > 0 ? 1 : 0)))
  }
}

/** Allele-level filter sensitivity (share of causal alleles that pass the gate). */
export function filterSensitivity(cases: CaseResult[]): number {
  const flags = cases.flatMap((c) => c.causalEligible)
  return mean(flags.map((f) => (f ? 1 : 0)))
}

/** Gene-cluster sensitivity counts for Clopper–Pearson (§11.5.4): failures = clusters with ≥ 1 gated-out causal allele. */
export function clusterSensitivityCounts(
  cases: CaseResult[],
  clusterOf: (c: CaseResult) => string = (c) => c.gene
): { n: number; failures: number } {
  const failed = new Map<string, boolean>()
  for (const c of cases) {
    const bad = c.causalEligible.some((e) => !e)
    failed.set(clusterOf(c), (failed.get(clusterOf(c)) ?? false) || bad)
  }
  let failures = 0
  for (const f of failed.values()) if (f) failures += 1
  return { n: failed.size, failures }
}

/** Burden: median eligible rows per case. */
export const burden = (cases: CaseResult[]): number => median(cases.map((c) => c.eligible))
