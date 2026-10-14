/**
 * The HPO DAG on typed arrays (#600): term ids, IC, is_a parents in CSR and a
 * topological order. sim(a, b) = IC of the most informative common ancestor
 * (MICA); since Anc(t) = {t} ∪ ⋃ Anc(parent), one pass in topological order
 * propagates it to every term (see phenotype-score.ts). Pure.
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
}

export interface HpoIndexInput {
  terms: ReadonlyArray<{ id: string; ic: number }>
  /** [child, parent] is_a edges between known terms */
  edges: ReadonlyArray<readonly [string, string]>
  /** [alias, current term] */
  aliases: ReadonlyArray<readonly [string, string]>
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
  return { ids, index, ic, parentOffsets, parents, topo }
}

/** Stamp t and all its ancestors with `stamp`. */
export function markAncestors(ix: HpoIndex, t: number, mark: Int32Array, stamp: number): void {
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
