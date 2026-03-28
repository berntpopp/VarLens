import type { ColumnFiltersParam } from '../../shared/types/column-filters'

/** Affected status for case metadata */
export type AffectedStatus = 'affected' | 'unaffected' | 'unknown'
/** Biological sex for case metadata */
export type CaseSex = 'unknown' | 'male' | 'female' | 'other'

/**
 * CaseWithCohorts - Case entity enriched with cohort membership and metadata
 *
 * Returned by CaseRepository.queryCases() which uses a single JOIN query
 * instead of per-case metadata lookups.
 */
export interface CaseWithCohorts extends Case {
  cohort_names: string[]
  cohort_ids: number[]
  affected_status?: AffectedStatus | null
  sex?: CaseSex | null
}

/**
 * CaseSearchParams - Pagination, sorting, and filtering for case queries
 */
export interface CaseSearchParams {
  limit: number
  offset?: number
  sort_by?: 'name' | 'created_at' | 'variant_count'
  sort_order?: 'asc' | 'desc'
  search_term?: string
  cohort_ids?: number[]
  hpo_ids?: string[]
  _count_needed?: boolean
}

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
  /** Genome build (GRCh37 or GRCh38), defaults to GRCh38 */
  genome_build: string
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
  /** Internal allele frequency across all cases (computed, not stored on variants table) */
  internal_af?: number | null
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
  /** Filter to variants starred in this case */
  starred_only?: boolean
  /** Filter to variants with per-case or global comments */
  has_comment?: boolean
  /** Filter by ACMG classification (OR logic) */
  acmg_classifications?: string[]
  /** Per-column typed filters (key = column name, value = operator + value) */
  column_filters?: ColumnFiltersParam
  /** Annotation scope for star/ACMG filters: 'case' = per-case only, 'all' = per-case OR global */
  annotation_scope?: 'case' | 'all'
  /** Pre-computed genomic intervals from active gene panels */
  panel_intervals?: Array<{ chr: string; start: number; end: number }>
  /** Active panel IDs (IPC-only, resolved to panel_intervals before query) */
  active_panel_ids?: number[]
  /** Panel padding in base pairs (IPC-only, used during interval computation) */
  panel_padding_bp?: number
  /** Maximum internal allele frequency (0-1) */
  max_internal_af?: number
  /** Inheritance mode filters */
  inheritance_modes?: string[]
  /** Analysis group ID for trio-based inheritance filtering */
  analysis_group_id?: number
  /** Whether to consider phasing for compound het */
  consider_phasing?: boolean
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
 * PaginatedResult - generic paginated response wrapper
 */
export interface PaginatedResult<T> {
  /** Array of result items */
  data: T[]
  /** Total count of matching items (for Vuetify items-length) */
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
  /** Biological sex */
  sex: 'unknown' | 'male' | 'female' | 'other' | null
  /** Case notes */
  notes: string | null
  /** Age at assessment */
  age: number | null
  /** Date of birth (ISO string) */
  date_of_birth: string | null
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds */
  updated_at: number
}

/**
 * CaseDataInfo - Tracks import provenance, platform, and pre-filtering metadata
 */
export interface CaseDataInfo {
  id: number
  case_id: number
  /** Original import file name (basename) */
  import_file_name: string | null
  /** Detected file format (columnar, object, simple) */
  import_file_type: string | null
  /** Sequencing platform (exome_twist, exome_agilent, genome, panel, other) */
  platform: string | null
  /** Free text platform details */
  platform_details: string | null
  /** AF filter applied before import (e.g. "gnomAD < 0.01") */
  af_filter: string | null
  /** Gene list filter applied before import */
  gene_list_filter: string | null
  /** Region filter applied before import */
  region_filter: string | null
  /** Quality filter applied before import */
  quality_filter: string | null
  /** Additional notes about data provenance */
  data_notes: string | null
  /** FK to gene_lists (optional curated gene list link) */
  gene_list_id: number | null
  /** FK to region_files (optional BED region file link) */
  region_file_id: number | null
  created_at: number
  updated_at: number
}

/** Update payload for CaseDataInfo */
export interface CaseDataInfoUpdates {
  platform?: string | null
  platform_details?: string | null
  af_filter?: string | null
  gene_list_filter?: string | null
  region_filter?: string | null
  quality_filter?: string | null
  data_notes?: string | null
  gene_list_id?: number | null
  region_file_id?: number | null
}

/**
 * CaseExternalId - User-defined key-value pair for cross-referencing
 */
export interface CaseExternalId {
  id: number
  case_id: number
  id_type: string
  id_value: string
  created_at: number
}

/**
 * GeneList - Curated reusable gene list
 */
export interface GeneList {
  id: number
  name: string
  description: string | null
  created_at: number
  updated_at: number
}

export interface GeneListWithCount extends GeneList {
  gene_count: number
}

/**
 * RegionFile - Stored BED region file
 */
export interface RegionFile {
  id: number
  name: string
  description: string | null
  region_count: number
  total_bases: number
  created_at: number
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

/**
 * CaseComment - Timestamped, categorized case comments
 */
export interface CaseComment {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Comment category */
  category:
    | 'Clinical Note'
    | 'Lab Result'
    | 'Interpretation'
    | 'Follow-up'
    | 'Family History'
    | 'Treatment'
  /** Comment content */
  content: string
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds, null until edited */
  updated_at: number | null
}

/**
 * Comment category type
 */
export type CommentCategory = CaseComment['category']

/**
 * MetricDefinition - Global metric catalog (predefined + user-created)
 */
export interface MetricDefinition {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Metric name (e.g., "Hemoglobin (Hb)") */
  name: string
  /** Expected value type */
  value_type: 'numeric' | 'text' | 'date'
  /** Unit (e.g., "g/dL"), empty string for dimensionless */
  unit: string
  /** Category (e.g., "Hematology") */
  category: string
  /** 1 = shipped default, 0 = user-created */
  is_predefined: number
  /** Unix timestamp in milliseconds */
  created_at: number
}

/**
 * CaseMetric - Per-case metric value (EAV pattern)
 */
export interface CaseMetric {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Foreign key to cases table */
  case_id: number
  /** Foreign key to metric_definitions table */
  metric_id: number
  /** Set when value_type = numeric */
  numeric_value: number | null
  /** Set when value_type = text */
  text_value: string | null
  /** ISO 8601 date string, set when value_type = date */
  date_value: string | null
  /** Unix timestamp in milliseconds */
  created_at: number
  /** Unix timestamp in milliseconds */
  updated_at: number
}

/**
 * CaseMetricWithDefinition - Joined view for display
 */
export interface CaseMetricWithDefinition extends CaseMetric {
  /** Metric name */
  name: string
  /** Expected value type */
  value_type: 'numeric' | 'text' | 'date'
  /** Unit */
  unit: string
  /** Category */
  metric_category: string
}

/**
 * AnalysisGroup - Family or tumor/normal group definition
 */
export interface AnalysisGroup {
  id: number
  name: string
  group_type: 'family' | 'tumor_normal'
  description: string | null
  created_at: number
  updated_at: number
}

export type AnalysisGroupRole =
  | 'proband'
  | 'father'
  | 'mother'
  | 'sibling'
  | 'partner'
  | 'other'
  | 'tumor'
  | 'normal'

export type AffectedStatusValue = 'affected' | 'unaffected' | 'unknown'

/**
 * AnalysisGroupMember - Case membership within an analysis group
 */
export interface AnalysisGroupMember {
  id: number
  group_id: number
  case_id: number
  role: AnalysisGroupRole
  affected_status: AffectedStatusValue
  individual_id: string | null
}

/**
 * AnalysisGroupWithMembers - Analysis group with its members populated
 */
export interface AnalysisGroupWithMembers extends AnalysisGroup {
  members: AnalysisGroupMember[]
}

/**
 * Audit trail action types
 */
export type AuditActionType =
  | 'acmg_classify'
  | 'acmg_evidence_update'
  | 'star'
  | 'unstar'
  | 'comment_add'
  | 'comment_edit'
  | 'comment_delete'
  | 'tag_assign'
  | 'tag_remove'

/**
 * Audit trail entity types
 */
export type AuditEntityType = 'variant_annotation' | 'case_variant_annotation'

/**
 * AuditLogEntry - Immutable audit trail record
 */
export interface AuditLogEntry {
  /** SQLite INTEGER PRIMARY KEY AUTOINCREMENT */
  id: number
  /** Unix timestamp in milliseconds */
  timestamp: number
  /** Type of action performed */
  action_type: AuditActionType
  /** Entity type that was changed */
  entity_type: AuditEntityType
  /** Entity identifier (e.g., "chr1:12345:A:T" or "case:1:variant:42") */
  entity_key: string
  /** JSON snapshot of previous state (null for first action) */
  old_value: string | null
  /** JSON snapshot of new state */
  new_value: string | null
  /** Configurable user name */
  user_name: string | null
}
