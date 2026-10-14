// Gene → cross-validation fold (spec §5.2): sort, seeded Fisher–Yates shuffle, round-robin.
import { mulberry32 } from './prng'

export function geneFolds(genes: Iterable<string>, k: number, seed: number): Map<string, number> {
  if (!Number.isInteger(k) || k < 1)
    throw new Error(`fold count must be a positive integer, got ${k}`)
  const sorted = [...new Set(genes)].sort()
  const rnd = mulberry32(seed)
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
  }
  return new Map(sorted.map((g, i) => [g, i % k]))
}

/**
 * Gene → fold with every connected component of the gene–disease graph in one fold, so no
 * disease (and no gene sharing one) spans train and test. Deterministic: components, largest
 * first (ties by smallest gene), go to the fold with the fewest genes so far (ties: lowest index).
 */
export function componentFolds(
  pairs: Iterable<readonly [gene: string, disease: string]>,
  k: number
): Map<string, number> {
  if (!Number.isInteger(k) || k < 1)
    throw new Error(`fold count must be a positive integer, got ${k}`)
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root) ?? root
    for (let y = x; y !== root;) {
      const next = parent.get(y) ?? root
      parent.set(y, root)
      y = next
    }
    return root
  }
  for (const [g, d] of pairs) {
    for (const n of [`g:${g}`, `d:${d}`]) if (!parent.has(n)) parent.set(n, n)
    const a = find(`g:${g}`)
    const b = find(`d:${d}`)
    if (a !== b) parent.set(a, b)
  }
  const components = new Map<string, string[]>()
  for (const n of [...parent.keys()].sort()) {
    if (!n.startsWith('g:')) continue
    const root = find(n)
    const list = components.get(root)
    if (list) list.push(n.slice(2))
    else components.set(root, [n.slice(2)])
  }
  const sizes = new Array<number>(k).fill(0)
  const out = new Map<string, number>()
  const ordered = [...components.values()].sort(
    (a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1)
  )
  for (const genes of ordered) {
    const fold = sizes.indexOf(Math.min(...sizes))
    sizes[fold] += genes.length
    for (const g of genes) out.set(g, fold)
  }
  return out
}
