/**
 * Disease-level phenotype score v2 (spec §3) for every gene of a case. Pure
 * functions over a {@link PhenotypeIndex}; no allocation in the hot loops.
 *
 * 1. One topological sweep fills k interleaved lanes, lanes[t·k + l] =
 *    sim(p_l, t) = max IC over Anc(t) ∩ Anc(p_l), and the descendant bitmasks
 *    of the excluded terms (bit j of masks[t] ⟺ t ∈ Desc(e_j) ∪ {e_j}).
 * 2. One fused scan over the disease CSR: forward (max over d's terms per
 *    lane), reverse (Σ f·max_l lanes / IC(t), the per-term part precomputed) and the exclusion load
 *    (per-organ-system max of the conservative f_excl, plus NOT annotations).
 * 3. Gene = max over its diseases; the case percentile comes from one sort.
 * Explanations are rebuilt lazily from the lanes for displayed rows only.
 */
import { HPO_SCORING_CONFIG } from '../config/hpo-scoring.config'
import type { HpoConflict, HpoExplanation, HpoMatch, HpoProfileTerm } from '../types/hpo-profile'
import type { PhenotypeIndex } from './phenotype-index'
import { markAncestors } from './resnik'

export interface CaseProfile {
  /** present terms that are no ancestor of another present term, in input order */
  present: Int32Array
  /** key weight, max over the term's present ancestors-or-self */
  weight: Float64Array
  key: Uint8Array
  /** excluded terms that are no ancestor-or-self of a present term */
  excluded: Int32Array
  /** canonical profile, for memoising results */
  hash: string
}

export interface CaseScores {
  profile: CaseProfile
  /** indexed like `ix.hpo.genes`; -1 best disease = gene without diseases */
  geneScore: Float64Array
  geneBest: Int32Array
  /** excluded terms contradicted by the best disease */
  geneConflicts: Int32Array
  /** S(d) per disease, indexed like `ix.diseaseIds` */
  diseaseScore: Float64Array
  /** geneScore ascending, for the percentile */
  sorted: Float64Array
}

/** Grow-only buffers per index; scoring is synchronous, so one set serves every case. */
interface Scratch {
  /** float32: halves the scan's memory traffic; IC enters v2 at float32 precision (selfIc too) */
  lanes: Float32Array
  /** max_l sim(p_l, t) / IC(t): the reverse term, once per term instead of per annotation */
  reverse: Float64Array
  masks: Uint32Array
  mark: Int32Array
  stack: Int32Array
  stamp: number
  union: number
  owner: CaseScores | null
  laneMax: Float64Array
  laneW: Float64Array
  conflict: Float64Array
  sysMax: Float64Array
  diseaseConflicts: Int32Array
}
const scratches = new WeakMap<PhenotypeIndex, Scratch>()

function scratchFor(ix: PhenotypeIndex): Scratch {
  let s = scratches.get(ix)
  if (s === undefined) {
    const D = ix.diseaseIds.length
    s = {
      lanes: new Float32Array(0),
      reverse: new Float64Array(ix.hpo.ids.length),
      masks: new Uint32Array(0),
      mark: new Int32Array(ix.hpo.ids.length),
      stack: new Int32Array(ix.hpo.ids.length),
      stamp: 0,
      union: 0,
      owner: null,
      laneMax: new Float64Array(0),
      laneW: new Float64Array(0),
      conflict: new Float64Array(0),
      sysMax: new Float64Array(32),
      diseaseConflicts: new Int32Array(D)
    }
    scratches.set(ix, s)
  }
  return s
}

function grow<T extends Float64Array | Float32Array | Uint32Array>(
  buf: T,
  size: number,
  make: (n: number) => T
): T {
  return buf.length >= size ? buf : make(Math.max(size, buf.length * 2))
}

/**
 * Canonicalise (aliases, dedupe, uninformative and unknown terms dropped),
 * drop excluded ancestors-or-self of present terms, prune present ancestors
 * (the descendant keeps the higher weight). Null without a present term.
 */
export function prepareProfile(
  ix: PhenotypeIndex,
  terms: readonly HpoProfileTerm[]
): CaseProfile | null {
  const s = scratchFor(ix)
  const presentKey = new Map<number, boolean>()
  const excluded = new Set<number>()
  for (const term of terms) {
    const t = ix.hpo.index.get(term.hpoId)
    if (t === undefined || ix.selfIc[t] === 0) continue
    if (term.excluded) excluded.add(t)
    else presentKey.set(t, presentKey.get(t) === true || term.key)
  }
  const all = [...presentKey.keys()]
  if (all.length === 0) return null
  const weight = all.map((t) => (presentKey.get(t) === true ? HPO_SCORING_CONFIG.keyWeight : 1))
  const key = all.map((t) => presentKey.get(t) === true)
  const dropped = all.map(() => false)
  all.forEach((q, i) => {
    const stamp = ++s.stamp
    markAncestors(ix.hpo, q, s.mark, stamp)
    all.forEach((p, j) => {
      if (j === i || s.mark[p] !== stamp) return
      dropped[j] = true
      if (weight[j] > weight[i]) weight[i] = weight[j]
      key[i] ||= key[j]
    })
  })
  const union = ++s.stamp
  for (const p of all) markAncestors(ix.hpo, p, s.mark, union)
  const keep = all.flatMap((_, i) => (dropped[i] ? [] : [i]))
  const present = Int32Array.from(keep, (i) => all[i])
  const excl = Int32Array.from([...excluded].filter((e) => s.mark[e] !== union))
  const hash = [
    ...keep.map((i) => `${all[i]}:${weight[i]}:${key[i] ? 1 : 0}`).sort(),
    '|',
    ...[...excl].map(String).sort()
  ].join(',')
  return {
    present,
    weight: Float64Array.from(keep, (i) => weight[i]),
    key: Uint8Array.from(keep, (i) => (key[i] ? 1 : 0)),
    excluded: excl,
    hash
  }
}

/** Step 1: lanes, exclusion masks and the Anc(P⁺) stamp for `profile`, owned by `owner`. */
function fillLanes(
  ix: PhenotypeIndex,
  s: Scratch,
  profile: CaseProfile,
  owner: CaseScores | null
): void {
  const { topo, ic, parentOffsets, parents } = ix.hpo
  const V = ix.hpo.ids.length
  const k = profile.present.length
  const K = profile.excluded.length
  const chunks = (K + 31) >>> 5
  const lanes = (s.lanes = grow(s.lanes, V * k, (n) => new Float32Array(n)))
  const masks = (s.masks = grow(s.masks, V * chunks, (n) => new Uint32Array(n)))
  lanes.fill(0, 0, V * k)
  masks.fill(0, 0, V * chunks)
  // Seed lane l with IC on Anc(p_l) (stamped DFS; each ancestor once).
  for (let l = 0; l < k; l++) {
    const stamp = ++s.stamp
    let top = 0
    s.stack[top++] = profile.present[l]
    s.mark[profile.present[l]] = stamp
    while (top > 0) {
      const u = s.stack[--top]
      lanes[u * k + l] = ic[u]
      for (let j = parentOffsets[u]; j < parentOffsets[u + 1]; j++) {
        const p = parents[j]
        if (s.mark[p] !== stamp) {
          s.mark[p] = stamp
          s.stack[top++] = p
        }
      }
    }
  }
  const union = (s.union = ++s.stamp)
  for (let l = 0; l < k; l++) markAncestors(ix.hpo, profile.present[l], s.mark, union)
  for (let j = 0; j < K; j++) masks[profile.excluded[j] * chunks + (j >>> 5)] |= 1 << (j & 31)
  for (let i = 0; i < V; i++) {
    const t = topo[i]
    const base = t * k
    const mbase = t * chunks
    for (let j = parentOffsets[t]; j < parentOffsets[t + 1]; j++) {
      const p = parents[j]
      const pb = p * k
      for (let l = 0; l < k; l++)
        if (lanes[pb + l] > lanes[base + l]) lanes[base + l] = lanes[pb + l]
      for (let c = 0; c < chunks; c++) masks[mbase + c] |= masks[p * chunks + c]
    }
  }
  for (let t = 0; t < V; t++) {
    let u = 0
    for (let l = t * k, end = l + k; l < end; l++) if (lanes[l] > u) u = lanes[l]
    s.reverse[t] = u * ix.invIc[t]
  }
  s.owner = owner
}

/** Score every gene; null without a present term. */
export function scoreCase(ix: PhenotypeIndex, terms: readonly HpoProfileTerm[]): CaseScores | null {
  const profile = prepareProfile(ix, terms)
  return profile === null ? null : scoreProfile(ix, profile)
}

export function scoreProfile(ix: PhenotypeIndex, profile: CaseProfile): CaseScores {
  const { f0, gamma, lambda, eMax } = HPO_SCORING_CONFIG
  const s = scratchFor(ix)
  const G = ix.hpo.genes.size
  const result: CaseScores = {
    profile,
    geneScore: new Float64Array(G),
    geneBest: new Int32Array(G),
    geneConflicts: new Int32Array(G),
    diseaseScore: new Float64Array(ix.diseaseIds.length),
    sorted: new Float64Array(0)
  }
  fillLanes(ix, s, profile, result)
  const k = profile.present.length
  const K = profile.excluded.length
  const chunks = (K + 31) >>> 5
  const { lanes, reverse, masks, mark, union, sysMax, diseaseConflicts } = s
  const { diseaseScore } = result
  const laneMax = (s.laneMax = grow(s.laneMax, k, (n) => new Float64Array(n)))
  const laneW = (s.laneW = grow(s.laneW, k, (n) => new Float64Array(n)))
  const conflict = (s.conflict = grow(s.conflict, K, (n) => new Float64Array(n)))
  conflict.fill(0, 0, K)
  let wSum = 0
  for (let l = 0; l < k; l++) wSum += profile.weight[l]
  for (let l = 0; l < k; l++) laneW[l] = (profile.weight[l] * ix.invIc[profile.present[l]]) / wSum
  const exclSys = Uint32Array.from(profile.excluded, (e) => ix.systems[e])
  const { diseaseOffsets, annTerm, annF, annFExcl, annFactor, freqSum } = ix
  const { notOffsets, notTerms } = ix
  const D = ix.diseaseIds.length
  for (let d = 0; d < D; d++) {
    for (let l = 0; l < k; l++) laneMax[l] = 0
    let rev = 0
    let hit = false
    for (let j = diseaseOffsets[d]; j < diseaseOffsets[d + 1]; j++) {
      const t = annTerm[j]
      const fac = annFactor[j]
      const base = t * k
      for (let l = 0; l < k; l++) {
        const w = lanes[base + l] * fac
        if (w > laneMax[l]) laneMax[l] = w
      }
      rev += annF[j] * reverse[t]
      for (let c = 0; c < chunks; c++) {
        let m = masks[t * chunks + c]
        while (m !== 0) {
          const low = m & -m
          const idx = (c << 5) + 31 - Math.clz32(low)
          m ^= low
          if (annFExcl[j] > conflict[idx]) conflict[idx] = annFExcl[j]
          hit = true
        }
      }
    }
    let fwd = 0
    for (let l = 0; l < k; l++) fwd += laneW[l] * laneMax[l]
    let load = 0
    let conflicts = 0
    if (hit) {
      for (let idx = 0; idx < K; idx++) {
        const c = conflict[idx]
        if (c <= 0) continue
        conflict[idx] = 0
        conflicts++
        for (let sm = exclSys[idx]; sm !== 0; sm &= sm - 1) {
          const bit = 31 - Math.clz32(sm & -sm)
          if (c > sysMax[bit]) sysMax[bit] = c
        }
      }
      for (let b = 0; b < 32; b++) {
        load += sysMax[b]
        sysMax[b] = 0
      }
    }
    for (let j = notOffsets[d]; j < notOffsets[d + 1]; j++)
      if (mark[notTerms[j]] === union) load += 1
    if (load > eMax) load = eMax
    const plus = gamma * fwd + (1 - gamma) * (rev / (f0 + freqSum[d]))
    diseaseScore[d] = load > 0 ? plus * Math.exp(-lambda * load) : plus
    diseaseConflicts[d] = conflicts
  }
  const { geneOffsets, geneDiseases } = ix
  for (let g = 0; g < G; g++) {
    let best = -1
    let arg = -1
    for (let i = geneOffsets[g]; i < geneOffsets[g + 1]; i++) {
      const d = geneDiseases[i]
      if (diseaseScore[d] > best) {
        best = diseaseScore[d]
        arg = d
      }
    }
    result.geneScore[g] = arg < 0 ? 0 : best
    result.geneBest[g] = arg
    result.geneConflicts[g] = arg < 0 ? 0 : diseaseConflicts[arg]
  }
  result.sorted = result.geneScore.slice().sort()
  return result
}

/** Share of the case's genes scoring strictly lower than `score`. */
function percentile(sorted: Float64Array, score: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] < score) lo = mid + 1
    else hi = mid
  }
  return sorted.length === 0 ? 0 : lo / sorted.length
}

/** Best disease, matched pairs and conflicts of gene g; null when g has no disease. */
export function explainGene(ix: PhenotypeIndex, cs: CaseScores, g: number): HpoExplanation | null {
  const d = cs.geneBest[g]
  if (d < 0) return null
  const s = scratchFor(ix)
  if (s.owner !== cs) fillLanes(ix, s, cs.profile, cs)
  const { present, key, excluded } = cs.profile
  const k = present.length
  const chunks = (excluded.length + 31) >>> 5
  const from = ix.diseaseOffsets[d]
  const to = ix.diseaseOffsets[d + 1]
  const label = (t: number): string => ix.termLabels[t]
  const id = (t: number): string => ix.hpo.ids[t]
  const matched: HpoMatch[] = []
  for (let l = 0; l < k; l++) {
    let best = 0
    let arg = -1
    for (let j = from; j < to; j++) {
      const v = s.lanes[ix.annTerm[j] * k + l] * ix.annFactor[j]
      if (v > best) {
        best = v
        arg = j
      }
    }
    if (arg < 0 || best * ix.invIc[present[l]] < HPO_SCORING_CONFIG.explainMinMatch) continue
    const t = ix.annTerm[arg]
    matched.push({
      patientTerm: id(present[l]),
      patientLabel: label(present[l]),
      diseaseTerm: id(t),
      diseaseLabel: label(t),
      key: key[l] === 1,
      frequency: ix.annF[arg]
    })
  }
  matched.sort((a, b) => Number(b.key) - Number(a.key))
  const conflicts: HpoConflict[] = []
  excluded.forEach((e, j) => {
    let best = 0
    let arg = -1
    for (let a = from; a < to; a++) {
      const bit = (s.masks[ix.annTerm[a] * chunks + (j >>> 5)] >>> (j & 31)) & 1
      if (bit === 1 && ix.annFExcl[a] > best) {
        best = ix.annFExcl[a]
        arg = a
      }
    }
    if (arg < 0) return
    conflicts.push({
      excludedTerm: id(e),
      excludedLabel: label(e),
      diseaseTerm: id(ix.annTerm[arg]),
      diseaseLabel: label(ix.annTerm[arg]),
      frequency: best
    })
  })
  return {
    score: cs.geneScore[g],
    percentile: percentile(cs.sorted, cs.geneScore[g]),
    diseaseId: ix.diseaseIds[d],
    diseaseLabel: ix.diseaseLabels[d],
    matched,
    conflicts
  }
}
