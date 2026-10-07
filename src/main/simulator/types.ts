/**
 * Core type definitions for the VarLens synthetic variant simulator.
 */

export type ConsequenceImpact = 'HIGH' | 'MODERATE' | 'LOW' | 'MODIFIER'

export type GenotypeString = '0/1' | '1/1' | './1'

export interface TermAnnotation {
  accessionId: number
  name: string
  abbreviation: string | null
}

/**
 * Canonical variant object representation inside the simulator engine.
 * All format writers project from this unified schema.
 */
export interface CanonicalVariant {
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string
  omim_mim_number: string | null
  consequence: ConsequenceImpact
  func: string
  transcript: string
  cdna: string
  aa_change: string
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: GenotypeString
  qual: number | null
  gq: number | null
  dp: number | null
  ad_ref: number | null
  ad_alt: number | null
  hpo_sim_score: number | null
  hpo_match: TermAnnotation[]
  moi: TermAnnotation[]
}

/**
 * Metadata for a simulated case / sample.
 */
export interface SampleMetadata {
  lims_id: string
  person_id: number
  analysis_id: number
  case_name: string
}

export type SimulatorFormat = 'simple-json' | 'columnar-json' | 'vcf' | 'xlsx'

export type SimulatorPreset = 'panel' | 'exome' | 'smoke' | 'custom'

export interface SimulatorOptions {
  /** Number of samples to generate (default: 1) */
  samples: number
  /** Fixed variant count per sample, or variant target */
  variantsPerSample?: number
  /** Min variant count (if using randomized range) */
  variantsMin?: number
  /** Max variant count (if using randomized range) */
  variantsMax?: number
  /** Target formats to generate */
  formats: SimulatorFormat[]
  /** Compress JSON and VCF outputs with gzip */
  gzip?: boolean
  /** Directory where generated files are placed */
  outDir: string
  /** Master PRNG seed for deterministic reproducibility */
  seed?: number
  /** Number of parallel worker threads */
  workers?: number
  /** Preconfigured workload profile */
  preset?: SimulatorPreset
  /**
   * Share of each sample drawn from sites other samples can carry too
   * (0..1, default 0.9). Real exomes share most of their variants.
   */
  sharedFraction?: number
  /** Optional list of gene symbols to restrict variant generation to */
  geneFilter?: string[]
  /** Cancellation signal */
  signal?: AbortSignal
  /** Progress notification callback */
  onProgress?: (progress: SimulatorProgress) => void
}

export interface SimulatorProgress {
  currentSample: number
  totalSamples: number
  currentVariants: number
  totalVariants: number
  elapsedMs: number
  rateVariantsPerSec: number
  statusMessage?: string
}

export interface GeneratedSampleResult {
  sample: SampleMetadata
  variantCount: number
  seed: number
  generatedFiles: string[]
  elapsedMs: number
}

export interface CohortManifest {
  generator: string
  version: string
  generatedAt: string
  masterSeed: number
  preset: SimulatorPreset
  totalSamples: number
  totalVariants: number
  formats: SimulatorFormat[]
  gzipped: boolean
  samples: Array<{
    limsId: string
    personId: number
    analysisId: number
    variantCount: number
    seed: number
    files: string[]
  }>
}
