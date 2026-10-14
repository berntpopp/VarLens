/**
 * Symmetric Resnik BMA (#600) for every gene at once, by dynamic programming
 * over the HPO DAG on typed arrays. Pure, so the shortlist and the simulation
 * harness share it. sim(a, b) = IC of the most informative common ancestor
 * (MICA); gene score = mean of the patient→gene and gene→patient averages of
 * each term's best match (the Phenomizer / pyhpo "BMA" form). The one-sided
 * patient→gene average favours heavily annotated genes and collapses under
 * noisy profiles (Hit@10 14.3 % vs 32.1 % symmetric:
 * `.planning/artifacts/shortlist-sim/2026-10-14-resnik/gene-ranking.md`).
 *
 * Since Anc(t) = {t} ∪ ⋃ Anc(parent), one pass in topological order gives,
 * for a marked term set U, m[t] = max IC over Anc(t) ∩ U for every term t:
 * with U = Anc(p) that is sim(p, t) = IC(MICA(p, t)); with U = ⋃_p Anc(p) it is
 * max_p sim(p, t). Per case: O(k · (V + E + gene annotations)).
 */

export interface HpoIndex {
  /** term index → id */
  ids: readonly string[]
  /** term id or alias → term index */
  index: ReadonlyMap<string, number>
  ic: Float64Array
  /** direct is_a parents in CSR: parents of t are parents[parentOffsets[t] .. parentOffsets[t + 1]) */
  parentOffsets: Int32Array
  parents: Int32Array
  /** every term, parents before children */
  topo: Int32Array
  /** gene symbol → gene index; terms of g are geneTerms[geneOffsets[g] .. geneOffsets[g + 1]) */
  genes: ReadonlyMap<string, number>
  geneOffsets: Int32Array
  geneTerms: Int32Array
}

export interface HpoIndexInput {
  terms: ReadonlyArray<{ id: string; ic: number }>
  /** [child, parent] is_a edges between known terms */
  edges: ReadonlyArray<readonly [string, string]>
  /** [alias, current term] */
  aliases: ReadonlyArray<readonly [string, string]>
  /** [gene symbol, term] */
  geneTerms: ReadonlyArray<readonly [string, string]>
}

/** CSR of `pairs` (from, to) over `n` sources. */
function csr(n: number, pairs: ReadonlyArray<readonly [number, number]>): [Int32Array, Int32Array] {
  const offsets = new Int32Array(n + 1)
  for (const [from] of pairs) offsets[from + 1]++
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i]
  const fill = offsets.slice(0, n)
  const values = new Int32Array(pairs.length)
  for (const [from, to] of pairs) values[fill[from]++] = to
  return [offsets, values]
}

export function buildHpoIndex(input: HpoIndexInput): HpoIndex {
  const ids = input.terms.map((t) => t.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const ic = Float64Array.from(input.terms, (t) => t.ic)
  const n = ids.length
  const edges: Array<[number, number]> = []
  for (const [child, parent] of input.edges) {
    const c = index.get(child)
    const p = index.get(parent)
    if (c !== undefined && p !== undefined) edges.push([c, p])
  }
  const [parentOffsets, parents] = csr(n, edges)
  // Kahn: a term is emitted once all of its parents are.
  const [childOffsets, children] = csr(
    n,
    edges.map(([c, p]) => [p, c])
  )
  const pending = Int32Array.from({ length: n }, (_, t) => parentOffsets[t + 1] - parentOffsets[t])
  const topo = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let t = 0; t < n; t++) if (pending[t] === 0) topo[tail++] = t
  while (head < tail) {
    const t = topo[head++]
    for (let i = childOffsets[t]; i < childOffsets[t + 1]; i++) {
      if (--pending[children[i]] === 0) topo[tail++] = children[i]
    }
  }
  if (tail !== n) throw new Error('HPO index: is_a cycle')
  for (const [alias, term] of input.aliases) {
    const t = index.get(term)
    if (t !== undefined && !index.has(alias)) index.set(alias, t)
  }
  const genes = new Map<string, number>()
  const seen = new Set<string>()
  const pairs: Array<[number, number]> = []
  for (const [gene, term] of input.geneTerms) {
    const t = index.get(term)
    if (t === undefined) continue
    let g = genes.get(gene)
    if (g === undefined) genes.set(gene, (g = genes.size))
    if (seen.has(`${g}:${t}`)) continue
    seen.add(`${g}:${t}`)
    pairs.push([g, t])
  }
  const [geneOffsets, geneTerms] = csr(genes.size, pairs)
  return { ids, index, ic, parentOffsets, parents, topo, genes, geneOffsets, geneTerms }
}

/** out[t] = max IC over Anc(t) ∩ {u : mark[u] === stamp} (0 when empty). */
function propagate(ix: HpoIndex, mark: Int32Array, stamp: number, out: Float64Array): void {
  const { topo, ic, parentOffsets, parents } = ix
  for (let i = 0; i < topo.length; i++) {
    const t = topo[i]
    let v = mark[t] === stamp ? ic[t] : 0
    for (let j = parentOffsets[t]; j < parentOffsets[t + 1]; j++) {
      const up = out[parents[j]]
      if (up > v) v = up
    }
    out[t] = v
  }
}

/** Stamp t and all its ancestors with `stamp`. */
function markAncestors(ix: HpoIndex, t: number, mark: Int32Array, stamp: number): void {
  const stack = [t]
  mark[t] = stamp
  while (stack.length > 0) {
    const u = stack.pop()!
    for (let j = ix.parentOffsets[u]; j < ix.parentOffsets[u + 1]; j++) {
      const p = ix.parents[j]
      if (mark[p] !== stamp) {
        mark[p] = stamp
        stack.push(p)
      }
    }
  }
}

/**
 * Symmetric BMA of the patient's terms (canonicalised, deduplicated; unknown
 * ones dropped) against every gene, indexed like `ix.genes`; null when no
 * patient term is known.
 */
export function scoreAllGenes(ix: HpoIndex, patientTerms: readonly string[]): Float64Array | null {
  const profile = [
    ...new Set(patientTerms.map((t) => ix.index.get(t)).filter((t) => t !== undefined))
  ]
  if (profile.length === 0) return null
  const n = ix.ic.length
  const geneCount = ix.genes.size
  const { geneOffsets, geneTerms } = ix
  const mark = new Int32Array(n)
  const union = new Int32Array(n)
  const best = new Float64Array(n)
  const forward = new Float64Array(geneCount)
  profile.forEach((p, i) => {
    markAncestors(ix, p, mark, i + 1)
    markAncestors(ix, p, union, 1)
    propagate(ix, mark, i + 1, best)
    for (let g = 0; g < geneCount; g++) {
      let m = 0
      for (let j = geneOffsets[g]; j < geneOffsets[g + 1]; j++) {
        if (best[geneTerms[j]] > m) m = best[geneTerms[j]]
      }
      forward[g] += m
    }
  })
  propagate(ix, union, 1, best)
  const scores = new Float64Array(geneCount)
  for (let g = 0; g < geneCount; g++) {
    let sum = 0
    for (let j = geneOffsets[g]; j < geneOffsets[g + 1]; j++) sum += best[geneTerms[j]]
    const terms = geneOffsets[g + 1] - geneOffsets[g]
    scores[g] = (forward[g] / profile.length + sum / terms) / 2
  }
  return scores
}
