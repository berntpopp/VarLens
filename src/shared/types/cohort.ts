import type { ColumnFiltersParam } from './column-filters'

/**
 * Cohort analysis types for Varlens
 *
 * Types for aggregated variant analysis across multiple cases.
 */

/**
 * Aggregated variant across all cases in the cohort
 */
export interface CohortVariant {
  /** Chromosome */
  chr: string
  /** Genomic position */
  pos: number
  /** Reference allele */
  ref: string
  /** Alternate allele */
  alt: string
  /** Gene symbol (nullable) */
  gene_symbol: string | null
  /** cDNA HGVS notation (nullable) */
  cdna: string | null
  /** Protein change HGVS notation (nullable) */
  aa_change: string | null
  /** Number of cases carrying this variant */
  carrier_count: number
  /** Total number of cases in database */
  total_cases: number
  /** Allele frequency across cohort (carrier_count / total_cases) */
  cohort_frequency: number
  /** Number of heterozygous carriers */
  het_count: number
  /** Number of homozygous carriers */
  hom_count: number
  /** Composite key for stable v-data-table tracking: "chr:pos:ref:alt" */
  variant_key: string

  // Annotation columns (aggregated: MAX value across carriers)
  /** Impact level: HIGH, MODERATE, LOW, MODIFIER (nullable) */
  consequence: string | null
  /** Functional consequence type (nullable) */
  func: string | null
  /** ClinVar clinical significance (nullable) */
  clinvar: string | null
  /** gnomAD allele frequency (nullable) */
  gnomad_af: number | null
  /** CADD phred score (nullable) */
  cadd_phred: number | null
  /** Transcript ID (nullable) */
  transcript: string | null
  /** OMIM ID (nullable) */
  omim_id: string | null
}

/**
 * Individual case carrying a specific variant (for drill-down)
 */
export interface CohortCarrier {
  /** Case ID */
  case_id: number
  /** Case name */
  case_name: string
  /** Genotype (e.g., "0/1", "1/1") */
  gt_num: string
}

/**
 * Cohort-level summary statistics
 */
export interface CohortSummary {
  /** Total number of cases in database */
  total_cases: number
  /** Total variant observations (sum across all cases) */
  total_variants: number
  /** Number of unique variants (distinct chr:pos:ref:alt) */
  unique_variants: number
  /** Average variants per case */
  avg_variants_per_case: number
  /** Number of distinct genes with variants */
  genes_with_variants: number
  /** Number of starred variant annotations (global) */
  starred_variants: number
  /** ACMG classification distribution (global) */
  acmg_counts: {
    pathogenic: number
    likely_pathogenic: number
    vus: number
    likely_benign: number
    benign: number
  }
}

/**
 * Gene-level burden analysis (for Plan 02)
 */
export interface GeneBurden {
  /** Gene symbol */
  gene_symbol: string
  /** Total variant observations in this gene */
  variant_count: number
  /** Number of unique variants in this gene */
  unique_variant_count: number
  /** Number of cases with variants in this gene */
  affected_case_count: number
  /** Total cases in cohort */
  total_cases: number
}

/**
 * Paginated result for cohort queries
 */
export interface CohortPaginatedResult {
  /** Array of cohort variants */
  data: CohortVariant[]
  /** Total count of matching variants */
  total_count: number
}

/**
 * Search/filter parameters for cohort queries
 */
export interface CohortSearchParams {
  /** Search term (gene symbol, chr:pos) */
  search_term?: string
  /** Column to sort by */
  sort_by?: string
  /** Sort direction */
  sort_order?: 'asc' | 'desc'
  /** Page size */
  limit?: number
  /** Offset for pagination: (page - 1) * limit */
  offset?: number

  // Filter parameters (matching case analysis filters)
  /** Gene symbol exact match */
  gene_symbol?: string
  /** Impact levels to include (HIGH, MODERATE, LOW) */
  consequences?: string[]
  /** Functional consequence types to include */
  funcs?: string[]
  /** ClinVar classifications to include */
  clinvars?: string[]
  /** Maximum gnomAD allele frequency */
  gnomad_af_max?: number
  /** Minimum CADD phred score */
  cadd_min?: number
  /** Maximum internal allele frequency (cohort_frequency) */
  max_internal_af?: number
  /** Minimum carrier count */
  carrier_count_min?: number
  /** Show only starred variants (global annotations) */
  starred_only?: boolean
  /** Show only variants with comments (global annotations) */
  has_comment?: boolean
  /** Filter by ACMG classifications (global annotations) */
  acmg_classifications?: string[]
  /** Per-column typed filters (key = column name, value = operator + value) */
  column_filters?: ColumnFiltersParam
  /** Active panel IDs for region-based filtering */
  active_panel_ids?: number[]
  /** Padding in base pairs for panel interval computation */
  panel_padding_bp?: number
  /** Pre-computed genomic intervals from panel genes (set by IPC handler) */
  panel_intervals?: Array<{ chr: string; start: number; end: number }>
  /** Whether the total count needs to be recomputed (false = use cached count) */
  _count_needed?: boolean
}
