/**
 * Canonical variant generator.
 *
 * Produces biologically plausible, deterministically reproducible variants
 * grounded in real human gene coordinates and empirical clinical distributions.
 */
import type { CanonicalVariant, GenotypeString, SampleMetadata, SimulatorOptions } from './types'
import { DeterministicRandom } from './random'
import { GeneCatalog, type GeneModel } from './catalog'
import {
  CLINICAL_HPO_TERMS,
  CONSEQUENCE_PROFILES,
  generateHgvs,
  MOI_OPTIONS,
  NUCLEOTIDES,
  sampleAlternateAllele,
  sampleClinvar,
  sampleGenotype
} from './models'

const CHR_ORDER: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  '11': 11,
  '12': 12,
  '13': 13,
  '14': 14,
  '15': 15,
  '16': 16,
  '17': 17,
  '18': 18,
  '19': 19,
  '20': 20,
  '21': 21,
  '22': 22,
  X: 23,
  Y: 24,
  MT: 25,
  M: 25
}

export function compareGenomicPositions(
  chrA: string,
  posA: number,
  chrB: string,
  posB: number
): number {
  const orderA = CHR_ORDER[chrA] ?? 99
  const orderB = CHR_ORDER[chrB] ?? 99
  if (orderA !== orderB) return orderA - orderB
  return posA - posB
}

export interface GeneratorConfig {
  catalog: GeneCatalog
  masterSeed: number
  /** Common variant pool size for cohort sharing */
  commonPoolSize?: number
}

/** Share of a sample drawn from sites that other samples can carry too. */
export const DEFAULT_SHARED_FRACTION = 0.9

/** Allele-frequency range of shared sites; a sample carries each site with this probability. */
const SHARED_SITE_AF_MIN = 0.01
const SHARED_SITE_AF_MAX = 0.45
const SHARED_SITE_MEAN_AF = (SHARED_SITE_AF_MIN + SHARED_SITE_AF_MAX) / 2

/**
 * Number of shared sites needed so that a sample of `targetCount` variants
 * takes about `sharedFraction` of them from the pool. Real exomes share most
 * of their variants, and cohort tables behave very differently when they do.
 */
export function sharedPoolSizeFor(
  targetCount: number,
  sharedFraction: number = DEFAULT_SHARED_FRACTION
): number {
  if (!Number.isFinite(sharedFraction) || sharedFraction < 0 || sharedFraction > 1) {
    throw new Error(`sharedFraction must be between 0 and 1, got ${sharedFraction}`)
  }
  return Math.round((targetCount * sharedFraction) / SHARED_SITE_MEAN_AF)
}

/** Typical per-sample variant count for the options, used to size the shared pool. */
export function nominalVariantCount(
  options: Pick<SimulatorOptions, 'variantsPerSample' | 'variantsMin' | 'variantsMax' | 'preset'>
): number {
  if (options.variantsPerSample !== undefined) return options.variantsPerSample
  if (options.variantsMin !== undefined && options.variantsMax !== undefined) {
    return Math.round((options.variantsMin + options.variantsMax) / 2)
  }
  if (options.preset === 'exome') return 30000
  if (options.preset === 'smoke') return 100
  return 3700
}

/** The shared pool every sample of one cohort run draws from. */
export function createCohortSharedPool(
  catalog: GeneCatalog,
  options: SimulatorOptions,
  poolSeed: number
): CanonicalVariant[] {
  const size = sharedPoolSizeFor(nominalVariantCount(options), options.sharedFraction)
  return createSharedVariantPool(catalog, size, poolSeed)
}

/**
 * Pre-computes a pool of shared polymorphic variants for cohort consistency.
 * Sites are unique, so one sample never carries the same variant twice.
 */
export function createSharedVariantPool(
  catalog: GeneCatalog,
  poolSize: number,
  poolSeed: number
): CanonicalVariant[] {
  const rng = new DeterministicRandom(poolSeed)
  const pool: CanonicalVariant[] = []
  const seen = new Set<string>()
  const genes = catalog.getAll()

  while (pool.length < poolSize) {
    const variant = synthesizeSingleVariant(rng.pickOne(genes), rng, true)
    const key = `${variant.chr}:${variant.pos}:${variant.ref}:${variant.alt}`
    if (seen.has(key)) continue
    seen.add(key)
    pool.push(variant)
  }
  return pool
}

function synthesizeSingleVariant(
  gene: GeneModel,
  rng: DeterministicRandom,
  isCommon = false
): CanonicalVariant {
  const pos = rng.intBetween(gene.start_pos, gene.end_pos)
  const ref = rng.pickOne(NUCLEOTIDES)
  const alt = sampleAlternateAllele(ref, rng)

  // Common variants lean towards benign / synonymous / missense with low CADD
  let profile = rng.weightedPick(
    CONSEQUENCE_PROFILES,
    CONSEQUENCE_PROFILES.map((p) => p.weight)
  )
  if (isCommon && profile.consequence === 'HIGH') {
    profile = CONSEQUENCE_PROFILES[0] // Fallback to missense for common sites
  }

  const { cdna, aa_change } = generateHgvs(profile.func, ref, alt, rng)

  const caddRaw = rng.gaussian(profile.caddMean, profile.caddStdDev)
  const cadd = Math.max(0.1, Number(caddRaw.toFixed(1)))
  const gnomadAf = isCommon
    ? rng.floatBetween(SHARED_SITE_AF_MIN, SHARED_SITE_AF_MAX)
    : rng.sampleGnomadAf()
  const clinvar = sampleClinvar(profile.consequence, cadd, rng)
  const gtNum: GenotypeString = sampleGenotype(gene.chromosome, rng)

  const qual = rng.intBetween(250, 4500)
  const dp = rng.intBetween(30, 150)
  const gq = rng.intBetween(60, 99)
  let adAlt: number
  let adRef: number
  if (gtNum === '0/1') {
    adAlt = Math.round(dp * rng.floatBetween(0.4, 0.6))
    adRef = dp - adAlt
  } else if (gtNum === '1/1') {
    adAlt = Math.round(dp * rng.floatBetween(0.85, 1.0))
    adRef = dp - adAlt
  } else {
    adAlt = Math.round(dp * 0.3)
    adRef = dp - adAlt
  }

  // HPO similarity score
  let hpoSimScore: number | null = null
  if (
    clinvar === 'Pathogenic' ||
    clinvar === 'Likely_pathogenic' ||
    profile.consequence === 'HIGH'
  ) {
    hpoSimScore = Number(rng.floatBetween(0.65, 0.98).toFixed(2))
  } else if (rng.next() < 0.7) {
    hpoSimScore = Number(rng.floatBetween(0.05, 0.55).toFixed(2))
  }

  // HPO match list
  const hpoMatches = [rng.pickOne(CLINICAL_HPO_TERMS)]
  if (rng.next() < 0.4) {
    hpoMatches.push(rng.pickOne(CLINICAL_HPO_TERMS))
  }

  // MOI list
  const isChrX = gene.chromosome === 'X'
  const isChrY = gene.chromosome === 'Y'
  const moiItem =
    isChrX || isChrY
      ? rng.pickOne([MOI_OPTIONS[2], MOI_OPTIONS[3]])
      : rng.pickOne([MOI_OPTIONS[0], MOI_OPTIONS[1]])

  return {
    chr: gene.chromosome,
    pos,
    ref,
    alt,
    gene_symbol: gene.symbol,
    omim_mim_number: gene.omim_id,
    consequence: profile.consequence,
    func: profile.func,
    transcript: gene.primaryTranscript,
    cdna,
    aa_change,
    gnomad_af: gnomadAf !== null ? Number(gnomadAf.toExponential(4)) : null,
    cadd,
    clinvar,
    gt_num: gtNum,
    qual,
    gq,
    dp,
    ad_ref: adRef,
    ad_alt: adAlt,
    hpo_sim_score: hpoSimScore,
    hpo_match: hpoMatches,
    moi: [moiItem]
  }
}

/**
 * Generates all canonical variants for a single sample.
 * Variants are sorted naturally by (chr, pos) to guarantee standard genomic ordering.
 */
export function generateSampleVariants(
  _sample: SampleMetadata,
  targetCount: number,
  sampleSeed: number,
  catalog: GeneCatalog,
  sharedPool: CanonicalVariant[] = []
): CanonicalVariant[] {
  const rng = new DeterministicRandom(sampleSeed)
  const variants: CanonicalVariant[] = []
  const genes = catalog.getAll()

  // 1. Inherit common polymorphic variants based on their frequencies
  for (const common of sharedPool) {
    const af = common.gnomad_af ?? 0.05
    if (rng.next() < af) {
      // Clone common variant and customize for this sample
      const gt = sampleGenotype(common.chr, rng)
      variants.push({
        ...common,
        gt_num: gt
      })
      if (variants.length >= targetCount) break
    }
  }

  // 2. Synthesize private / rare variants until targetCount is reached
  while (variants.length < targetCount) {
    const gene = rng.pickOne(genes)
    const variant = synthesizeSingleVariant(gene, rng, false)
    variants.push(variant)
  }

  // 3. Natural genomic sorting (chr, pos)
  variants.sort((a, b) => compareGenomicPositions(a.chr, a.pos, b.chr, b.pos))

  return variants
}
