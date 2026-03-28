/**
 * Kysely database schema type definitions
 *
 * Maps every table in the VarLens SQLite database for compile-time query type safety.
 * These types must match the actual SQL schema in schema.ts and migrations.ts.
 */
import type { Generated } from 'kysely'

// ── Cases ──────────────────────────────────────────────────
export interface CasesTable {
  id: Generated<number>
  name: string
  file_path: string
  file_size: number
  variant_count: number
  created_at: number
  genome_build: string
}

// ── Variants ───────────────────────────────────────────────
export interface VariantsTable {
  id: Generated<number>
  case_id: number
  chr: string
  pos: number
  ref: string
  alt: string
  gene_symbol: string | null
  omim_mim_number: string | null
  consequence: string | null
  gnomad_af: number | null
  cadd: number | null
  clinvar: string | null
  gt_num: string | null
  func: string | null
  qual: number | null
  hpo_sim_score: number | null
  transcript: string | null
  cdna: string | null
  aa_change: string | null
  hpo_match: string | null
  moi: string | null
}

// ── Variant Transcripts ────────────────────────────────────
export interface VariantTranscriptsTable {
  id: Generated<number>
  variant_id: number
  transcript_id: string
  gene_symbol: string | null
  consequence: string | null
  cdna: string | null
  aa_change: string | null
  hpo_sim_score: number | null
  moi: string | null
  is_selected: number
  is_mane_select: number | null
  is_canonical: number | null
}

// ── Variant Annotations (global) ──────────────────────────
export interface VariantAnnotationsTable {
  id: Generated<number>
  chr: string
  pos: number
  ref: string
  alt: string
  global_comment: string | null
  starred: number
  acmg_classification: string | null
  acmg_evidence: string | null
  created_at: number
  updated_at: number
}

// ── Case Variant Annotations (per-case) ───────────────────
export interface CaseVariantAnnotationsTable {
  id: Generated<number>
  case_id: number
  variant_id: number
  per_case_comment: string | null
  created_at: number
  updated_at: number
  starred: number
  acmg_classification: string | null
  acmg_evidence: string | null
}

// ── Case Metadata ─────────────────────────────────────────
export interface CaseMetadataTable {
  id: Generated<number>
  case_id: number
  affected_status: string | null
  notes: string | null
  created_at: number
  updated_at: number
  sex: string | null
  age: number | null
  date_of_birth: string | null
}

// ── Cohort Groups ─────────────────────────────────────────
export interface CohortGroupsTable {
  id: Generated<number>
  name: string
  description: string | null
  created_at: number
}

// ── Case Cohort Links ─────────────────────────────────────
export interface CaseCohortLinksTable {
  id: Generated<number>
  case_id: number
  cohort_id: number
}

// ── API Cache ─────────────────────────────────────────────
export interface ApiCacheTable {
  id: Generated<number>
  cache_key: string
  response_data: string
  created_at: number
  expires_at: number
}

// ── Tags ──────────────────────────────────────────────────
export interface TagsTable {
  id: Generated<number>
  name: string
  color: string
  created_at: number
}

// ── Variant Tags ──────────────────────────────────────────
export interface VariantTagsTable {
  id: Generated<number>
  case_id: number
  variant_id: number
  tag_id: number
  created_at: number
}

// ── Case HPO Terms ────────────────────────────────────────
export interface CaseHpoTermsTable {
  id: Generated<number>
  case_id: number
  hpo_id: string
  hpo_label: string
  created_at: number
}

// ── Case Comments ─────────────────────────────────────────
export interface CaseCommentsTable {
  id: Generated<number>
  case_id: number
  category: string
  content: string
  created_at: number
  updated_at: number | null
}

// ── Metric Definitions ────────────────────────────────────
export interface MetricDefinitionsTable {
  id: Generated<number>
  name: string
  value_type: string
  unit: string
  category: string
  is_predefined: number
  created_at: number
}

// ── Case Metrics ──────────────────────────────────────────
export interface CaseMetricsTable {
  id: Generated<number>
  case_id: number
  metric_id: number
  numeric_value: number | null
  text_value: string | null
  date_value: string | null
  created_at: number
  updated_at: number
}

// ── Audit Log ─────────────────────────────────────────────
export interface AuditLogTable {
  id: Generated<number>
  timestamp: number
  action_type: string
  entity_type: string
  entity_key: string
  old_value: string | null
  new_value: string | null
  user_name: string | null
}

// ── Case Data Info ────────────────────────────────────────
export interface CaseDataInfoTable {
  id: Generated<number>
  case_id: number
  import_file_name: string | null
  import_file_type: string | null
  platform: string | null
  platform_details: string | null
  af_filter: string | null
  gene_list_filter: string | null
  region_filter: string | null
  quality_filter: string | null
  data_notes: string | null
  created_at: number
  updated_at: number
  gene_list_id: number | null
  region_file_id: number | null
}

// ── Case External IDs ─────────────────────────────────────
export interface CaseExternalIdsTable {
  id: Generated<number>
  case_id: number
  id_type: string
  id_value: string
  created_at: number
}

// ── Gene Lists ────────────────────────────────────────────
export interface GeneListsTable {
  id: Generated<number>
  name: string
  description: string | null
  created_at: number
  updated_at: number
}

// ── Gene List Items ───────────────────────────────────────
export interface GeneListItemsTable {
  id: Generated<number>
  gene_list_id: number
  gene_symbol: string
}

// ── Region Files ──────────────────────────────────────────
export interface RegionFilesTable {
  id: Generated<number>
  name: string
  description: string | null
  region_count: number
  total_bases: number
  created_at: number
  updated_at: number
}

// ── Region File Entries ───────────────────────────────────
export interface RegionFileEntriesTable {
  id: Generated<number>
  region_file_id: number
  chr: string
  start_pos: number
  end_pos: number
  label: string | null
}

// ── Users ────────────────────────────────────────────────
export interface UsersTable {
  id: Generated<number>
  username: string
  display_name: string | null
  password_hash: string
  role: string
  is_active: number
  must_change_password: number
  failed_login_count: number
  locked_until: string | null
  password_changed_at: string | null
  created_at: string
  created_by: number | null
  updated_at: string | null
}

// ── Database Settings ────────────────────────────────────
export interface DatabaseSettingsTable {
  key: string
  value: string
}

// ── Filter Presets ───────────────────────────────────────
export interface FilterPresetsTable {
  id: Generated<number>
  name: string
  description: string | null
  filter_json: string
  is_built_in: number
  is_visible: number
  sort_order: number
  created_at: number
  updated_at: number
}

// ── Panels ─────────────────────────────────────────────────
export interface PanelsTable {
  id: Generated<number>
  name: string
  description: string | null
  version: string | null
  source: string
  source_id: string | null
  source_metadata: string | null
  created_at: number
  updated_at: number
}

export interface PanelGenesTable {
  id: Generated<number>
  panel_id: number
  hgnc_id: string
  symbol: string
}

export interface CaseActivePanelsTable {
  case_id: number
  panel_id: number
  padding_bp: number
  activated_at: number
}

// ── Variant Frequency ────────────────────────────────────
export interface VariantFrequencyTable {
  chr: string
  pos: number
  ref: string
  alt: string
  case_count: number
}

// ── Analysis Groups ──────────────────────────────────────
export interface AnalysisGroupsTable {
  id: Generated<number>
  name: string
  group_type: string
  description: string | null
  created_at: number
  updated_at: number
}

// ── Analysis Group Members ───────────────────────────────
export interface AnalysisGroupMembersTable {
  id: Generated<number>
  group_id: number
  case_id: number
  role: string
  affected_status: string
  individual_id: string | null
}

// ── Full Database Schema ──────────────────────────────────
export interface VarlensDatabase {
  cases: CasesTable
  variants: VariantsTable
  variant_transcripts: VariantTranscriptsTable
  variant_annotations: VariantAnnotationsTable
  case_variant_annotations: CaseVariantAnnotationsTable
  case_metadata: CaseMetadataTable
  cohort_groups: CohortGroupsTable
  case_cohort_links: CaseCohortLinksTable
  api_cache: ApiCacheTable
  tags: TagsTable
  variant_tags: VariantTagsTable
  case_hpo_terms: CaseHpoTermsTable
  case_comments: CaseCommentsTable
  metric_definitions: MetricDefinitionsTable
  case_metrics: CaseMetricsTable
  audit_log: AuditLogTable
  case_data_info: CaseDataInfoTable
  case_external_ids: CaseExternalIdsTable
  gene_lists: GeneListsTable
  gene_list_items: GeneListItemsTable
  region_files: RegionFilesTable
  region_file_entries: RegionFileEntriesTable
  users: UsersTable
  database_settings: DatabaseSettingsTable
  filter_presets: FilterPresetsTable
  panels: PanelsTable
  panel_genes: PanelGenesTable
  case_active_panels: CaseActivePanelsTable
  variant_frequency: VariantFrequencyTable
  analysis_groups: AnalysisGroupsTable
  analysis_group_members: AnalysisGroupMembersTable
}
