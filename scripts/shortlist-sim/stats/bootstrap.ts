// Cluster bootstrap over gene clusters (spec §5.4): every observation of a cluster is
// resampled together; 95 % percentile interval; deterministic per seed.
import { mulberry32 } from './prng'

export interface Interval {
  estimate: number
  lo: number
  hi: number
}

export const DEFAULT_REPS = 2000

/** Linear-interpolated quantile (type 7) of an ascending array. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  const pos = (sorted.length - 1) * q
  const i = Math.floor(pos)
  const frac = pos - i
  return i + 1 < sorted.length ? sorted[i] + frac * (sorted[i + 1] - sorted[i]) : sorted[i]
}

function groupBy<T>(items: T[], clusterOf: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const t of items) {
    const key = clusterOf(t)
    const list = m.get(key)
    if (list) list.push(t)
    else m.set(key, [t])
  }
  return m
}

/** Draws reps resamples (with replacement) of the cluster ids; ids are sorted so the draw depends only on the id set and seed. */
function* resamples(ids: string[], reps: number, seed: number): Generator<string[]> {
  const rnd = mulberry32(seed)
  for (let r = 0; r < reps; r++) {
    const draw = new Array<string>(ids.length)
    for (let i = 0; i < ids.length; i++) draw[i] = ids[Math.floor(rnd() * ids.length)]
    yield draw
  }
}

function percentile(estimate: number, stats: number[]): Interval {
  const finite = stats.filter(Number.isFinite).sort((a, b) => a - b)
  return { estimate, lo: quantile(finite, 0.025), hi: quantile(finite, 0.975) }
}

export function clusterBootstrap<T>(
  items: T[],
  clusterOf: (t: T) => string,
  stat: (sample: T[]) => number,
  reps = DEFAULT_REPS,
  seed = 1
): Interval {
  const byCluster = groupBy(items, clusterOf)
  const ids = [...byCluster.keys()].sort()
  const stats: number[] = []
  for (const draw of resamples(ids, reps, seed)) {
    stats.push(stat(draw.flatMap((id) => byCluster.get(id) ?? [])))
  }
  return percentile(stat(items), stats)
}

/**
 * Paired difference stat(a) − stat(b): one resample of the union of cluster ids per
 * replicate, applied to both item sets (same clusters for both scorers).
 */
export function pairedClusterBootstrap<T>(
  a: T[],
  b: T[],
  clusterOf: (t: T) => string,
  stat: (sample: T[]) => number,
  reps = DEFAULT_REPS,
  seed = 1
): Interval {
  const byA = groupBy(a, clusterOf)
  const byB = groupBy(b, clusterOf)
  const ids = [...new Set([...byA.keys(), ...byB.keys()])].sort()
  const stats: number[] = []
  for (const draw of resamples(ids, reps, seed)) {
    const sa = draw.flatMap((id) => byA.get(id) ?? [])
    const sb = draw.flatMap((id) => byB.get(id) ?? [])
    stats.push(stat(sa) - stat(sb))
  }
  return percentile(stat(a) - stat(b), stats)
}
