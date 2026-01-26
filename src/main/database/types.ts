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
  /** Variant consequence, nullable */
  consequence: string | null
  /** gnomAD allele frequency, nullable */
  gnomad_af: number | null
  /** CADD score, nullable */
  cadd: number | null
  /** ClinVar classification, nullable */
  clinvar: string | null
}

/**
 * VariantFilter - filter criteria for variant queries
 */
export interface VariantFilter {
  /** Required - always filter by case */
  case_id: number
  /** Partial match filter on gene symbol */
  gene_symbol?: string
  /** Exact match filter on consequence */
  consequence?: string
  /** Maximum gnomAD allele frequency */
  gnomad_af_max?: number
  /** Minimum CADD score */
  cadd_min?: number
  /** FTS5 full-text search query */
  search_query?: string
}

/**
 * PaginationCursor - cursor for keyset pagination
 */
export interface PaginationCursor {
  /** Last row id */
  id: number
  /** Value of sort column for keyset pagination */
  sort_value: number | string
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
