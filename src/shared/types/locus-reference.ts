/**
 * Locus reference data for CNV and STR phenotype scoring, read from
 * `hpo_similarity.db` (CNV/STR spec §3, §5.1, §6.1). Null when the tables are
 * absent: CNV and STR phenotype scores are then null.
 */

/**
 * ClinGen dosage score: 0–3 evidence, 30 = gene associated with autosomal
 * recessive phenotype, 40 = dosage sensitivity unlikely; null = not curated.
 */
export type DosageScore = 0 | 1 | 2 | 3 | 30 | 40 | null

/** One ClinGen-curated gene (`dosage_genes`), keyed by HGNC id, never by symbol. */
export interface DosageGene {
  /** e.g. `HGNC:11592` */
  hgncId: string
  symbol: string
  /** haploinsufficiency */
  hi: DosageScore
  /** triplosensitivity */
  ts: DosageScore
}

/** One ClinGen-curated region (`dosage_regions`) in one build. */
export interface DosageRegion {
  /** e.g. `ISCA-37400` */
  iscaId: string
  build: string
  chr: string
  start: number
  end: number
  label: string
  hi: DosageScore
  ts: DosageScore
  /** OMIM/ORPHA ids (Mondo-mapped) of the loss and gain phenotypes */
  lossDiseases: string[]
  gainDiseases: string[]
}

/** Status band of an STR call against its catalogue locus (spec §5.2). */
export type StrBand = 'normal' | 'intermediate' | 'premutation' | 'full'

/** Disease ids per band; `femaleOnly` ids are dropped for male cases. */
export interface StrDiseaseSets {
  full: string[]
  premutation?: string[]
  intermediate?: string[]
  femaleOnly?: string[]
}

/** Coordinates of a locus in one build, as given by STRchive. */
export interface StrLocusSpan {
  start: number
  stop: number
}

/** One normalised STRchive locus (`str_loci.json`), with the overrides applied. */
export interface StrLocus {
  /** STRchive id, e.g. `ATXN3_SCA3` */
  id: string
  gene: string
  chrom: string
  hg19: StrLocusSpan | null
  hg38: StrLocusSpan | null
  /** pathogenic motifs (any orientation; compared up to rotation and reverse complement) */
  pathogenicMotifs: string[]
  benignMax: number | null
  intermediateMin: number | null
  intermediateMax: number | null
  pathogenicMin: number | null
  /** e.g. `['AD']`, `['AR']`, `['XR']` */
  inheritance: string[]
  /** STRchive evidence level, e.g. `Definitive`, `Refuted` */
  evidence: string | null
  onsetMin: number | null
  onsetMax: number | null
  diseases: StrDiseaseSets
}

export interface LocusReference {
  /** HGNC id → curated gene */
  dosageGenes: ReadonlyMap<string, DosageGene>
  dosageRegions: readonly DosageRegion[]
  strLoci: readonly StrLocus[]
  /** Version per source, as in `HpoDataStatus.sources` (the tooltip names the ClinGen date). */
  sources: Readonly<Record<string, string>>
}
