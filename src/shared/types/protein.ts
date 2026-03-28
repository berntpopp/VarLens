/**
 * Protein visualization types
 * Used by UniProt, InterPro, AlphaFold, and gnomAD API clients
 */

/** UniProt mapping result: gene symbol → protein info */
export interface ProteinMapping {
  uniprotAccession: string
  geneName: string
  proteinName: string
  proteinLength: number
}

/** InterPro protein domain */
export interface ProteinDomain {
  accession: string
  name: string
  type: string
  start: number
  end: number
}

/** AlphaFold / PDB structure source */
export interface StructureSource {
  source: 'alphafold' | 'pdb'
  url: string
  format: 'cif' | 'pdb' | 'bcif'
  id: string
  resolution?: number
  coverage?: string
  version?: number
}

/** Resolved structure info for a protein */
export interface ProteinStructureInfo {
  uniprotAccession: string
  alphafold: StructureSource | null
  pdb: StructureSource | null
}

/** gnomAD population variant */
export interface GnomadVariant {
  variantId: string
  proteinPosition: number | null
  hgvsp: string | null
  consequence: string
  alleleFrequency: number
  alleleCount: number
  alleleNumber: number
}

/** gnomAD fetch result with cache info */
export interface GnomadFetchResult {
  success: true
  variants: GnomadVariant[]
  geneId: string
  dataset: string
  cacheInfo: { cached: boolean; cachedAt?: number }
}

/** Protein mapping fetch result */
export interface ProteinMappingResult {
  success: true
  mapping: ProteinMapping
  cacheInfo: { cached: boolean; cachedAt?: number }
}

/** Protein domain fetch result */
export interface ProteinDomainResult {
  success: true
  domains: ProteinDomain[]
  proteinLength: number
  cacheInfo: { cached: boolean; cachedAt?: number }
}

/** Protein structure fetch result */
export interface ProteinStructureResult {
  success: true
  structure: ProteinStructureInfo
  cacheInfo: { cached: boolean; cachedAt?: number }
}

/** Common error result for all protein API calls */
export interface ProteinApiError {
  success: false
  error: string
  offline?: boolean
}

/** ClinVar variant from gnomAD API */
export interface ClinVarVariant {
  variantId: string
  clinicalSignificance: string
  clinvarVariationId: string
  goldStars: number
  proteinPosition: number | null
  hgvsp: string | null
  consequence: string
  alleleFrequency: number | null
  /** Genomic position (from gnomAD API pos field) for gene structure rendering */
  genomicPosition: number | null
}

/** ClinVar significance categories for filtering */
export type ClinVarSignificance =
  | 'pathogenic'
  | 'likely_pathogenic'
  | 'uncertain'
  | 'likely_benign'
  | 'benign'
  | 'other'

/** ClinVar fetch result with cache info */
export interface ClinVarFetchResult {
  success: true
  variants: ClinVarVariant[]
  cacheInfo: { cached: boolean; cachedAt?: number }
}

// ── Gene Structure types ─────────────────────────────────────────────

/** A single exon in a gene structure */
export interface GeneExon {
  start: number
  end: number
  rank: number
}

/** Gene structure with exon coordinates for a transcript */
export interface GeneStructure {
  geneSymbol: string
  chromosome: string
  start: number
  end: number
  strand: 1 | -1
  transcriptId: string
  exons: GeneExon[]
}

/** Gene structure fetch result with cache info */
export interface GeneStructureResult {
  success: true
  geneStructure: GeneStructure
  cacheInfo: { cached: boolean; cachedAt?: number }
}

/** Consequence category for color mapping */
export type ConsequenceCategory =
  | 'missense'
  | 'truncating'
  | 'inframe'
  | 'splice'
  | 'synonymous'
  | 'other'

/** Variant prepared for lollipop plot rendering */
export interface LollipopVariant {
  proteinPosition: number
  aaChange: string | null
  consequence: string
  consequenceCategory: ConsequenceCategory
  color: string
  geneSymbol: string
  chr: string
  pos: number
  ref: string
  alt: string
  gnomadAf: number | null
  cadd: number | null
  clinvar: string | null
  /** Whether this variant should be visually highlighted (e.g. the selected variant) */
  highlighted?: boolean
}
