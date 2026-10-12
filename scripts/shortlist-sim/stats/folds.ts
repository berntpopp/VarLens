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
