/**
 * Shared filter types for variant filtering across components
 *
 * Moves filter type definitions from local component/composable definitions
 * to shared types for consistency and single source of truth.
 *
 * Used by:
 * - src/renderer/src/utils/filters/* (pure utilities)
 * - src/renderer/src/composables/useFilters.ts
 * - CohortTable.vue, FilterToolbar.vue
 */

// TODO: The renderer has local copies of FilterState in composables/filter-types.ts
// and composables/useFilters.ts that must be kept in sync. Consider consolidating.

/**
 * Active filter representation for chip display
 */
export interface ActiveFilter {
  /** Unique filter identifier (e.g., 'gene', 'frequency', 'impact') */
  id: string
  /** Human-readable label for display */
  label: string
  /** Current filter value as string */
  value: string
}

/**
 * Filter state for cohort/variant queries
 * All numeric thresholds stored as decimals (0-1 for percentages)
 */
export interface FilterState {
  /** Gene symbol filter (FTS5 search) */
  geneSymbol: string
  /** Full-text search term */
  searchQuery: string
  /** Selected consequence types (HIGH, MODERATE, etc.) */
  consequences: string[]
  /** Selected functional annotations */
  funcs: string[]
  /** Selected ClinVar classifications */
  clinvars: string[]
  /** Maximum gnomAD allele frequency (0-1) */
  maxGnomadAf: number | null
  /** Minimum CADD score (0-60) */
  minCadd: number | null
  /** Minimum carrier count - cohort view only */
  minCarriers: number | null
  /** Show only starred variants */
  starredOnly: boolean
  /** Show only variants with comments */
  hasCommentOnly: boolean
  /** Filter by ACMG classifications */
  acmgClassifications: string[]
  /** Active gene panel IDs for region-based filtering */
  activePanelIds: number[]
  /** Padding in base pairs around panel gene regions */
  panelPaddingBp: number
  /** Maximum internal database allele frequency (0-1) */
  maxInternalAf: number | null
  /** Selected inheritance mode filters (multi-select) */
  inheritanceModes: string[]
  /** Active analysis group ID for trio filtering */
  analysisGroupId: number | null
  /** Consider phasing information for compound het */
  considerPhasing: boolean
}

/**
 * IPC-safe filter parameters for database queries
 * Uses snake_case to match database column naming
 */
export interface FilterIpcParams {
  search_term?: string
  gene_symbol?: string
  consequences?: string[]
  funcs?: string[]
  clinvars?: string[]
  gnomad_af_max?: number
  cadd_min?: number
  carrier_count_min?: number
  starred_only?: boolean
  has_comment?: boolean
  acmg_classifications?: string[]
  active_panel_ids?: number[]
  panel_padding_bp?: number
  max_internal_af?: number
  inheritance_modes?: string[]
  analysis_group_id?: number
  consider_phasing?: boolean
}
