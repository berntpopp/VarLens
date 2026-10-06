/**
 * Biological mutation and annotation models for realistic variant simulation.
 */
import type { ConsequenceImpact, GenotypeString, TermAnnotation } from './types'
import type { DeterministicRandom } from './random'

export interface ConsequenceProfile {
  consequence: ConsequenceImpact
  func: string
  weight: number
  caddMean: number
  caddStdDev: number
}

/**
 * Standard consequence hierarchy and empirical weights typical for human clinical panels / exomes.
 */
export const CONSEQUENCE_PROFILES: readonly ConsequenceProfile[] = [
  // MODERATE IMPACT (Missense & In-frame)
  {
    consequence: 'MODERATE',
    func: 'missense_variant',
    weight: 48,
    caddMean: 22.5,
    caddStdDev: 5.0
  },
  { consequence: 'MODERATE', func: 'inframe_deletion', weight: 2, caddMean: 20.0, caddStdDev: 4.5 },
  {
    consequence: 'MODERATE',
    func: 'inframe_insertion',
    weight: 1,
    caddMean: 19.5,
    caddStdDev: 4.5
  },

  // LOW IMPACT (Synonymous & Splice Region)
  { consequence: 'LOW', func: 'synonymous_variant', weight: 24, caddMean: 8.5, caddStdDev: 3.5 },
  { consequence: 'LOW', func: 'splice_region_variant', weight: 3, caddMean: 12.0, caddStdDev: 4.0 },
  { consequence: 'LOW', func: 'stop_retained_variant', weight: 1, caddMean: 7.5, caddStdDev: 3.0 },

  // HIGH IMPACT (Loss of Function & Severe)
  { consequence: 'HIGH', func: 'stop_gained', weight: 2.5, caddMean: 34.0, caddStdDev: 4.0 },
  { consequence: 'HIGH', func: 'frameshift_variant', weight: 2.0, caddMean: 32.5, caddStdDev: 4.5 },
  {
    consequence: 'HIGH',
    func: 'splice_donor_variant',
    weight: 1.0,
    caddMean: 31.0,
    caddStdDev: 4.0
  },
  {
    consequence: 'HIGH',
    func: 'splice_acceptor_variant',
    weight: 1.0,
    caddMean: 31.5,
    caddStdDev: 4.0
  },
  { consequence: 'HIGH', func: 'start_lost', weight: 0.3, caddMean: 27.0, caddStdDev: 3.5 },
  { consequence: 'HIGH', func: 'stop_lost', weight: 0.2, caddMean: 26.0, caddStdDev: 3.5 },

  // MODIFIER IMPACT (Intronic & UTR)
  { consequence: 'MODIFIER', func: 'intron_variant', weight: 8, caddMean: 4.5, caddStdDev: 3.0 },
  {
    consequence: 'MODIFIER',
    func: '3_prime_UTR_variant',
    weight: 3,
    caddMean: 5.0,
    caddStdDev: 3.0
  },
  {
    consequence: 'MODIFIER',
    func: '5_prime_UTR_variant',
    weight: 2,
    caddMean: 6.0,
    caddStdDev: 3.5
  }
]

export const AMINO_ACIDS = [
  'Ala',
  'Arg',
  'Asn',
  'Asp',
  'Cys',
  'Gln',
  'Glu',
  'Gly',
  'His',
  'Ile',
  'Leu',
  'Lys',
  'Met',
  'Phe',
  'Pro',
  'Ser',
  'Thr',
  'Trp',
  'Tyr',
  'Val'
] as const

export const NUCLEOTIDES = ['A', 'C', 'G', 'T'] as const

/**
 * Transitions (A<->G, C<->T) are ~2-3x more frequent than transversions in human coding regions.
 */
export function sampleAlternateAllele(ref: string, rng: DeterministicRandom): string {
  const transitions: Record<string, string> = { A: 'G', G: 'A', C: 'T', T: 'C' }
  const transversions: Record<string, string[]> = {
    A: ['C', 'T'],
    G: ['C', 'T'],
    C: ['A', 'G'],
    T: ['A', 'G']
  }

  // 70% probability transition, 30% transversion
  if (rng.next() < 0.7 && transitions[ref] !== undefined) {
    return transitions[ref]
  }
  const tvs = transversions[ref] ?? ['A', 'C', 'G', 'T'].filter((b) => b !== ref)
  return rng.pickOne(tvs)
}

/**
 * Generates realistic HGVS c. and p. strings matching the Sequence Ontology consequence.
 */
export function generateHgvs(
  func: string,
  ref: string,
  alt: string,
  rng: DeterministicRandom
): { cdna: string; aa_change: string } {
  const cdnaPos = rng.intBetween(15, 3500)
  const codonPos = Math.floor(cdnaPos / 3) + 1
  const aa1 = rng.pickOne(AMINO_ACIDS)
  let aa2 = rng.pickOne(AMINO_ACIDS)
  while (aa2 === aa1) {
    aa2 = rng.pickOne(AMINO_ACIDS)
  }

  switch (func) {
    case 'missense_variant':
      return {
        cdna: `c.${cdnaPos}${ref}>${alt}`,
        aa_change: `p.${aa1}${codonPos}${aa2}`
      }
    case 'synonymous_variant':
    case 'stop_retained_variant':
      return {
        cdna: `c.${cdnaPos}${ref}>${alt}`,
        aa_change: `p.${aa1}${codonPos}=`
      }
    case 'stop_gained':
      return {
        cdna: `c.${cdnaPos}${ref}>${alt}`,
        aa_change: `p.${aa1}${codonPos}*`
      }
    case 'frameshift_variant': {
      const shiftLength = rng.pickOne([1, 2, 4, 5])
      return {
        cdna: `c.${cdnaPos}del`,
        aa_change: `p.${aa1}${codonPos}fs*${shiftLength + 3}`
      }
    }
    case 'inframe_deletion':
      return {
        cdna: `c.${cdnaPos}_${cdnaPos + 2}del`,
        aa_change: `p.${aa1}${codonPos}del`
      }
    case 'inframe_insertion':
      return {
        cdna: `c.${cdnaPos}_${cdnaPos + 1}ins${alt}`,
        aa_change: `p.${aa1}${codonPos}ins${aa2}`
      }
    case 'splice_donor_variant':
      return {
        cdna: `c.${cdnaPos}+1${ref}>${alt}`,
        aa_change: 'p.?'
      }
    case 'splice_acceptor_variant':
      return {
        cdna: `c.${cdnaPos}-1${ref}>${alt}`,
        aa_change: 'p.?'
      }
    case 'splice_region_variant':
      return {
        cdna: `c.${cdnaPos}+3${ref}>${alt}`,
        aa_change: 'p.?'
      }
    case 'intron_variant':
      return {
        cdna: `c.${cdnaPos}+${rng.intBetween(20, 500)}${ref}>${alt}`,
        aa_change: 'p.?'
      }
    default:
      return {
        cdna: `c.${cdnaPos}${ref}>${alt}`,
        aa_change: 'p.?'
      }
  }
}

/**
 * Samples a ClinVar classification conditional on CADD and consequence impact.
 */
export function sampleClinvar(
  consequence: ConsequenceImpact,
  cadd: number | null,
  rng: DeterministicRandom
): string | null {
  // ~40% of simulated variants have no ClinVar record
  if (rng.next() < 0.4) {
    return null
  }

  const score = (cadd ?? 10) + (consequence === 'HIGH' ? 15 : consequence === 'MODERATE' ? 5 : 0)

  if (score > 32) {
    return rng.weightedPick(
      ['Pathogenic', 'Likely_pathogenic', 'Uncertain_significance'],
      [65, 30, 5]
    )
  }
  if (score > 20) {
    return rng.weightedPick(
      [
        'Uncertain_significance',
        'Likely_pathogenic',
        'Likely_benign',
        'Conflicting_classifications_of_pathogenicity'
      ],
      [50, 20, 20, 10]
    )
  }
  return rng.weightedPick(['Benign', 'Likely_benign', 'Uncertain_significance'], [60, 35, 5])
}

/**
 * Samples a genotype call with realistic heterozygosity ratios.
 */
export function sampleGenotype(_chromosome: string, rng: DeterministicRandom): GenotypeString {
  // 75% het, 23% hom, 2% low-quality partial call
  const r = rng.next()
  if (r < 0.75) return '0/1'
  if (r < 0.98) return '1/1'
  return './1'
}

/**
 * Standard Mode of Inheritance categories with accession IDs.
 */
export const MOI_OPTIONS: readonly TermAnnotation[] = [
  { accessionId: 1, name: 'Autosomal dominant inheritance', abbreviation: 'AD' },
  { accessionId: 2, name: 'Autosomal recessive inheritance', abbreviation: 'AR' },
  { accessionId: 3, name: 'X-linked dominant inheritance', abbreviation: 'XD' },
  { accessionId: 4, name: 'X-linked recessive inheritance', abbreviation: 'XR' },
  { accessionId: 5, name: 'Non-Mendelian inheritance', abbreviation: null },
  { accessionId: 6, name: 'Typically de novo', abbreviation: null }
]

/**
 * Curated clinical HPO phenotypes for simulated matching.
 */
export const CLINICAL_HPO_TERMS: readonly TermAnnotation[] = [
  { accessionId: 1001, name: 'Short stature', abbreviation: 'HP:0004322' },
  { accessionId: 1002, name: 'Skeletal dysplasia', abbreviation: 'HP:0002652' },
  { accessionId: 1003, name: 'Osteogenesis imperfecta', abbreviation: 'HP:0000001' },
  { accessionId: 1004, name: 'Craniosynostosis', abbreviation: 'HP:0001363' },
  { accessionId: 1005, name: 'Microcephaly', abbreviation: 'HP:0000252' },
  { accessionId: 1006, name: 'Polydactyly', abbreviation: 'HP:0010442' },
  { accessionId: 1007, name: 'Brachydactyly', abbreviation: 'HP:0001156' },
  { accessionId: 1008, name: 'Scoliosis', abbreviation: 'HP:0002650' },
  { accessionId: 1009, name: 'Kyphosis', abbreviation: 'HP:0002808' },
  { accessionId: 1010, name: 'Hearing impairment', abbreviation: 'HP:0000365' },
  { accessionId: 1011, name: 'Renal cyst', abbreviation: 'HP:0000107' },
  { accessionId: 1012, name: 'Seizure', abbreviation: 'HP:0001250' },
  { accessionId: 1013, name: 'Intellectual disability', abbreviation: 'HP:0001249' },
  { accessionId: 1014, name: 'Joint hypermobility', abbreviation: 'HP:0001382' },
  { accessionId: 1015, name: 'Hypophosphatemia', abbreviation: 'HP:0002148' }
]
