/**
 * Pseudoautosomal region (PAR) coordinates for GRCh37 and GRCh38.
 * Variants in PAR regions on chrX/chrY are treated as autosomal.
 */

interface Region {
  start: number
  end: number
}

interface BuildPARs {
  X: Region[]
  Y: Region[]
}

const PAR_REGIONS: Record<string, BuildPARs> = {
  GRCh38: {
    X: [
      { start: 10_001, end: 2_781_479 },
      { start: 155_701_383, end: 156_030_895 }
    ],
    Y: [
      { start: 10_001, end: 2_781_479 },
      { start: 56_887_903, end: 57_217_415 }
    ]
  },
  GRCh37: {
    X: [
      { start: 60_001, end: 2_699_520 },
      { start: 154_931_044, end: 155_260_560 }
    ],
    Y: [
      { start: 10_001, end: 2_649_520 },
      { start: 59_034_050, end: 59_363_566 }
    ]
  }
}

function normalizeChr(chr: string): string {
  return chr.replace(/^chr/i, '').toUpperCase()
}

/**
 * Check if a genomic position falls within a pseudoautosomal region.
 * PAR variants on chrX/chrY should be treated as autosomal (diploid in males).
 */
export function isInPAR(chr: string, pos: number, build: string): boolean {
  const normalized = normalizeChr(chr)
  if (normalized !== 'X' && normalized !== 'Y') return false

  const buildPARs: BuildPARs | undefined = PAR_REGIONS[build]
  if (buildPARs == null) return false

  const regions = buildPARs[normalized as 'X' | 'Y']
  return regions.some((r) => pos >= r.start && pos <= r.end)
}

/**
 * Check if a chromosome is a sex chromosome (X or Y).
 */
export function isSexChromosome(chr: string): boolean {
  const normalized = normalizeChr(chr)
  return normalized === 'X' || normalized === 'Y'
}
