/**
 * Database entity types for Varlens
 *
 * These interfaces match the SQLite database schema exactly.
 * Property names use snake_case to match SQLite column naming conventions.
 */

/**
 * Case entity - represents an imported VCF file and its metadata
 */
export interface Case {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Unique case name */
  name: string
  /** Original import file path */
  file_path: string
  /** File size in bytes */
  file_size: number
  /** Count of variants for this case */
  variant_count: number
  /** Unix timestamp in milliseconds */
  created_at: number
}

/**
 * Variant entity - represents a single genomic variant
 */
export interface Variant {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Chromosome (e.g., "1", "X", "MT") */
  chr: string
  /** Genomic position */
  pos: number
  /** Reference allele */
  ref: string
  /** Alternate allele */
  alt: string
  /** Gene symbol, nullable */
  gene_symbol: string | null
  /** OMIM MIM number for the gene, nullable */
  omim_mim_number: string | null
  /** Variant consequence, nullable */
  consequence: string | null
  /** gnomAD allele frequency, nullable */
  gnomad_af: number | null
  /** CADD score, nullable */
  cadd: number | null
  /** ClinVar classification, nullable */
  clinvar: string | null
  /** Genotype (e.g., "0/1", "1/1"), nullable */
  gt_num: string | null
  /** Functional annotation, nullable */
  func: string | null
  /** Quality score, nullable */
  qual: number | null
  /** HPO similarity score, nullable */
  hpo_sim_score: number | null
  /** Transcript ID, nullable */
  transcript: string | null
  /** cDNA change notation, nullable */
  cdna: string | null
  /** Amino acid change notation, nullable */
  aa_change: string | null
  /** Mode of inheritance, nullable */
  moi: string | null
}

/**
 * VariantFilter - filter criteria for variant queries
 */
export interface VariantFilter {
  /** Required - always filter by case */
  case_id: number
  /** Partial match filter on gene symbol */
  gene_symbol?: string
  /** Exact match filter on consequence (single value, deprecated) */
  consequence?: string
  /** Multi-select filter on consequences (OR logic) */
  consequences?: string[]
  /** Multi-select filter on func values (OR logic) */
  funcs?: string[]
  /** Multi-select filter on ClinVar values (OR logic) */
  clinvars?: string[]
  /** Maximum gnomAD allele frequency */
  gnomad_af_max?: number
  /** Minimum CADD score */
  cadd_min?: number
  /** FTS5 full-text search query */
  search_query?: string
  /** Exact chromosome match (for variant navigation) */
  chr?: string
  /** Exact position match (for variant navigation) */
  pos?: number
  /** Exact ref allele match (for variant navigation) */
  ref?: string
  /** Exact alt allele match (for variant navigation) */
  alt?: string
  /** Filter by tag IDs (OR logic) */
  tag_ids?: number[]
}

/**
 * SortItem - defines a column sort specification
 * Compatible with Vuetify v-data-table-server sortBy format
 */
export interface SortItem {
  /** Column key to sort by */
  key: string
  /** Sort direction: 'asc' or 'desc' */
  order: 'asc' | 'desc'
}

/**
 * PaginationCursor - cursor for keyset pagination
 */
export interface PaginationCursor {
  /** Last row id */
  id: number
  /** Value of primary sort column for keyset pagination */
  sort_value: number | string | null
  /** Column key being sorted (needed to resume correctly) */
  sort_key: string
}

/**
 * PaginatedResult - generic paginated response wrapper
 */
export interface PaginatedResult<T> {
  /** Array of result items */
  data: T[]
  /** Cursor for next page, null if no more results */
  next_cursor: PaginationCursor | null
  /** Whether there are more results */
  has_more: boolean
  /** Total count of matching items */
  total_count: number
}

/**
 * ACMG Classification - 5-tier variant pathogenicity classification
 */
export type AcmgClassification =
  | 'Pathogenic'
  | 'Likely Pathogenic'
  | 'VUS'
  | 'Likely Benign'
  | 'Benign'

/**
 * ACMG Evidence - Structure for acmg_evidence JSON field
 */
export interface AcmgEvidence {
  /** Pathogenic evidence codes (e.g., ['PVS1', 'PS1', 'PM2']) */
  pathogenic: string[]
  /** Benign evidence codes (e.g., ['BA1', 'BS2']) */
  benign: string[]
  /** Evidence notes */
  notes: string
  /** Unix timestamp of classification date in milliseconds */
  classification_date: number
}

/**
 * VariantAnnotation - Global annotations keyed by chr:pos:ref:alt
 */
export interface VariantAnnotation {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Chromosome */
  chr: string
  /** Genomic position */
  pos: number
  /** Reference allele */
  ref: string
  /** Alternate allele */
  alt: string
  /** Global comment for this variant */
  global_comment: string | null
  /** Star flag (0 or 1, SQLite boolean) */
  starred: number
  /** ACMG classification */
  acmg_classification: AcmgClassification | null
  /** ACMG evidence (JSON string of AcmgEvidence) */
  acmg_evidence: string | null
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds */
  updated_at: number
}

/**
 * CaseVariantAnnotation - Per-case annotations
 */
export interface CaseVariantAnnotation {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Foreign key to variants table */
  variant_id: number
  /** Per-case comment */
  per_case_comment: string | null
  /** Star flag (0 or 1, SQLite boolean) - per-case */
  starred: number
  /** ACMG classification - per-case */
  acmg_classification: AcmgClassification | null
  /** ACMG evidence (JSON string of AcmgEvidence) - per-case */
  acmg_evidence: string | null
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds */
  updated_at: number
}

/**
 * CaseMetadata - Case status and notes
 */
export interface CaseMetadata {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Affected status */
  affected_status: 'affected' | 'unaffected' | 'unknown' | null
  /** Case notes */
  notes: string | null
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds */
  updated_at: number
}

/**
 * CohortGroup - User-defined cohort definitions
 */
export interface CohortGroup {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Cohort name */
  name: string
  /** Cohort description */
  description: string | null
  /** Unix timestamp in milliseconds */
  created_at: number
}

/**
 * CaseCohortLink - Case-to-cohort junction
 */
export interface CaseCohortLink {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Foreign key to cohort_groups table */
  cohort_id: number
}

/**
 * ApiCache - VEP/HPO response caching
 */
export interface ApiCache {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Cache key */
  cache_key: string
  /** Response data (JSON string) */
  response_data: string
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds */
  expires_at: number
}

/**
 * Tag - Custom tag definitions
 */
export interface Tag {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Tag name */
  name: string
  /** Tag color (hex color) */
  color: string
  /** Unix timestamp in milliseconds */
  created_at: number
}

/**
 * VariantTag - Per-case tag assignments
 */
export interface VariantTag {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Foreign key to variants table */
  variant_id: number
  /** Foreign key to tags table */
  tag_id: number
  /** Unix timestamp in milliseconds */
  created_at: number
}

/**
 * CaseHpoTerm - HPO term assignments to cases
 */
export interface CaseHpoTerm {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** HPO ID (e.g., "HP:0001250") */
  hpo_id: string
  /** HPO label */
  hpo_label: string
  /** Unix timestamp in milliseconds */
  created_at: number
}
