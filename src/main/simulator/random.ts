/**
 * Fast deterministic pseudo-random number generator and statistical distribution helpers.
 *
 * Uses Mulberry32: a 32-bit state PRNG with excellent statistical properties,
 * uniform output across all Node.js/V8 platforms, and 0 external dependencies.
 */

/**
 * 32-bit FNV-1a hash to convert strings / compound keys into deterministic integer seeds.
 */
export function hashSeed(value: string | number): number {
  const str = String(value)
  let hash = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

/**
 * Derives an independent sub-stream seed for a specific sample or domain.
 */
export function deriveSeed(masterSeed: number, index: number, domain = 'sample'): number {
  return hashSeed(`${masterSeed}:${domain}:${index}`)
}

/**
 * Mulberry32 PRNG instance.
 */
export class DeterministicRandom {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
    if (this.state === 0) {
      this.state = 0x6d2b79f5
    }
  }

  /**
   * Returns a float in [0, 1).
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /**
   * Returns an integer in [min, max] inclusive.
   */
  intBetween(min: number, max: number): number {
    if (min >= max) return min
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  /**
   * Returns a float in [min, max).
   */
  floatBetween(min: number, max: number): number {
    return this.next() * (max - min) + min
  }

  /**
   * Pick one item uniformly from an array.
   */
  pickOne<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array')
    }
    return items[Math.floor(this.next() * items.length)]
  }

  /**
   * Pick one item according to relative weights.
   */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    if (items.length !== weights.length || items.length === 0) {
      throw new Error('Items and weights must be non-empty and have matching lengths')
    }
    let totalWeight = 0
    for (let i = 0; i < weights.length; i++) {
      totalWeight += weights[i]
    }
    let threshold = this.next() * totalWeight
    for (let i = 0; i < items.length; i++) {
      threshold -= weights[i]
      if (threshold <= 0) {
        return items[i]
      }
    }
    return items[items.length - 1]
  }

  /**
   * Box-Muller transform for standard Gaussian sampling.
   */
  gaussian(mean = 0, stdDev = 1): number {
    let u1 = this.next()
    while (u1 === 0) u1 = this.next()
    const u2 = this.next()
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
    return z0 * stdDev + mean
  }

  /**
   * Samples a realistic gnomAD allele frequency.
   *
   * Real clinical variants follow a multi-stratum mixture:
   * - 20% novel (null)
   * - 50% ultra-rare / rare: power law from 1e-6 to 0.001
   * - 20% low frequency: 0.001 to 0.05
   * - 10% common: 0.05 to 0.50
   */
  sampleGnomadAf(): number | null {
    const r = this.next()
    if (r < 0.2) {
      return null // Novel / unobserved variant
    }
    if (r < 0.7) {
      // Ultra-rare / rare: power law between 1e-6 and 0.001
      // Using log-uniform distribution
      const logMin = -6
      const logMax = -3
      const exponent = this.floatBetween(logMin, logMax)
      return Math.pow(10, exponent)
    }
    if (r < 0.9) {
      // Low-frequency: 0.001 to 0.05
      const logMin = -3
      const logMax = -1.3
      const exponent = this.floatBetween(logMin, logMax)
      return Math.pow(10, exponent)
    }
    // Common: 0.05 to 0.50
    return this.floatBetween(0.05, 0.5)
  }

  /**
   * Deterministic in-place Fisher-Yates array shuffle.
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      const temp = array[i]
      array[i] = array[j]
      array[j] = temp
    }
    return array
  }
}
