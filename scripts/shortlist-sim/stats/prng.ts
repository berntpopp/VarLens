// Local seeded PRNG for the statistics layer (lane C owns common/rng.ts).
// ponytail: merge with common/rng.ts once both lanes land, if that one is also mulberry32.

/** mulberry32: deterministic uniform [0, 1) generator from a 32-bit seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
