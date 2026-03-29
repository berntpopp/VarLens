// Auto-update types
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateStatus {
  state: UpdateState
  version?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
}

export interface UpdaterAPI {
  checkForUpdate: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => Promise<void>
  getStatus: () => Promise<UpdateStatus>
  onStatusChange: (callback: (status: UpdateStatus) => void) => () => void
}

// Import database and import types for reuse
import type {
  Case,
  CaseWithCohorts,
  CaseSearchParams,
  AffectedStatus,
  CaseSex,
  Variant,
  VariantFilter,
  PaginatedResult,
  SortItem,
  VariantAnnotation,
  CaseVariantAnnotation,
  AcmgClassification,
  CaseMetadata,
  CohortGroup,
  CaseHpoTerm,
  Tag,
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition,
  AuditLogEntry,
  CaseDataInfo,
  CaseDataInfoUpdates,
  CaseExternalId,
  GeneList,
  GeneListWithCount,
  RegionFile
} from '../../main/database/types'
import type { ProgressUpdate, ImportResult } from '../../main/import/types'
import type { SerializableError } from './errors'
import type {
  CohortVariant,
  CohortSummary,
  CohortSearchParams,
  CohortCarrier,
  GeneBurden
} from './cohort'
import type {
  VepFetchResult,
  HpoSearchResult,
  CacheSizeInfo,
  CacheInfo,
  MyVariantFetchResult,
  SpliceAIFetchResult
} from './api-enrichment'
import type { ColumnFilterMeta } from './column-filters'
import type { FilterPreset, FilterPresetCreate, FilterPresetUpdate } from './filter-presets'
import type { LogMessage } from './log'
import type { TranscriptAnnotation, TranscriptInsertRow } from './transcript'
import type { DatabaseOverview } from './database-overview'
import type {
  GeneValidationResult,
  GeneAutocompleteResult,
  GeneRefInfo,
  AssemblyInfo
} from '../../main/database/GeneReferenceDb'
import type {
  PanelRow,
  PanelWithCount,
  PanelGeneRow,
  ActivePanelRow
} from '../../main/database/PanelRepository'
import type { PanelAppSearchResult } from '../../main/services/api/PanelAppClient'
import type {
  ProteinMappingResult,
  ProteinDomainResult,
  ProteinStructureResult,
  GeneStructureResult,
  GnomadFetchResult,
  ClinVarFetchResult,
  ProteinApiError
} from './protein'

// Re-export for convenience
export type {
  Case,
  CaseWithCohorts,
  CaseSearchParams,
  AffectedStatus,
  CaseSex,
  Variant,
  VariantFilter,
  PaginatedResult,
  SortItem,
  ProgressUpdate,
  ImportResult,
  CohortVariant,
  CohortSummary,
  CohortSearchParams,
  VepFetchResult,
  HpoSearchResult,
  CacheSizeInfo,
  CacheInfo,
  CaseMetadata,
  CohortGroup,
  CaseHpoTerm,
  Tag,
  TranscriptInsertRow,
  CaseComment,
  CommentCategory,
  MetricDefinition,
  CaseMetric,
  CaseMetricWithDefinition,
  AuditLogEntry,
  CaseDataInfo,
  CaseDataInfoUpdates,
  CaseExternalId,
  GeneList,
  GeneListWithCount,
  RegionFile,
  PanelRow,
  PanelWithCount,
  PanelGeneRow,
  ActivePanelRow,
  GeneValidationResult,
  GeneAutocompleteResult,
  GeneRefInfo,
  AssemblyInfo,
  PanelAppSearchResult
}

export interface CasesAPI {
  list: () => Promise<Case[]>
  query: (params: CaseSearchParams) => Promise<{ data: CaseWithCohorts[]; total_count: number }>
  delete: (id: number) => Promise<void>
  deleteAll: () => Promise<number>
  deleteBatch: (ids: number[]) => Promise<number>
}

export interface VariantsAPI {
  query: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    offset?: number,
    limit?: number,
    sortBy?: SortItem[]
  ) => Promise<PaginatedResult<Variant>>
  getFilterOptions: (caseId: number) => Promise<FilterOptions>
  search: (caseId: number, query: string, limit?: number) => Promise<Variant[]>
}

export interface FilterOptions {
  consequences: string[]
  funcs: string[]
  clinvars: string[]
  minCadd: number | null
  maxCadd: number | null
  minGnomadAf: number | null
  maxGnomadAf: number | null
  /** Per-column metadata for filter UI auto-detection */
  columnMeta: ColumnFilterMeta[]
}

export interface ImportAPI {
  selectFile: () => Promise<string | null>
  start: (filePath: string, caseName: string) => Promise<ImportResult | SerializableError>
  onProgress: (callback: (progress: ProgressUpdate) => void) => () => void
  cancel: () => Promise<void>
}

export interface SystemAPI {
  getVersion: () => Promise<{ app: string; electron: string }>
  getUserDataPath: () => Promise<string>
  getCpuCount: () => Promise<number>
  setWorkerThreads: (count: number) => Promise<void>
  getWorkerThreads: () => Promise<number>
}

export interface ShellOpenExternalResult {
  success: boolean
  error?: string
}

export interface ShellAPI {
  openExternal: (url: string) => Promise<ShellOpenExternalResult>
  updateDomains: (domains: string[]) => Promise<void>
}

export interface ExportAPI {
  variants: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    caseName: string
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>
  cohort: (
    params: CohortSearchParams
  ) => Promise<{ success: boolean; filePath?: string; error?: string }>
}

export interface DatabaseInfo {
  path: string
  name: string
  encrypted: boolean
}

export interface DatabaseOpenResult {
  success: boolean
  needsPassword?: boolean
  error?: string
  info?: DatabaseInfo
}

export interface RecentDatabase {
  path: string
  name: string
  lastOpened: number
}

export interface DatabaseAPI {
  selectFile: () => Promise<string | null>
  selectSaveLocation: (defaultName: string) => Promise<string | null>
  open: (path: string, password?: string) => Promise<DatabaseOpenResult>
  create: (path: string, password?: string) => Promise<DatabaseOpenResult>
  rekey: (newPassword: string) => Promise<{ success: boolean; error?: string }>
  info: () => Promise<DatabaseInfo | null>
  recentList: () => Promise<RecentDatabase[]>
  getOverview: () => Promise<DatabaseOverview>
}

// Batch import types
export type BatchFileStatus = 'pending' | 'importing' | 'success' | 'failed' | 'skipped'

export interface BatchFileDetail {
  filePath: string
  fileName: string
  status: BatchFileStatus
  caseName?: string
  variantCount?: number
  error?: string
}

export interface BatchProgress {
  currentIndex: number // 0-based index of current file
  totalFiles: number // Total files in batch
  currentFileName: string // Name of file being processed
  fileProgress?: ProgressUpdate // Per-file variant progress (reuse existing type)
  overallPercent: number // 0-100 overall percentage
}

export interface BatchResult {
  succeeded: number
  failed: number
  skipped: number
  cancelled: boolean
  details: BatchFileDetail[]
}

export type DuplicateChoice = 'skip' | 'overwrite'

export interface DuplicateCheckItem {
  filePath: string
  fileName: string
  caseName: string
  isDuplicate: boolean
}

export interface DuplicateCheckResult {
  files: DuplicateCheckItem[]
  duplicateCount: number
}

export interface BatchImportAPI {
  selectFiles: () => Promise<string[]>
  selectFolder: () => Promise<string[]>
  checkDuplicates: (filePaths: string[], stripText?: string) => Promise<DuplicateCheckResult>
  start: (
    filePaths: string[],
    duplicateStrategy: DuplicateChoice,
    stripText?: string
  ) => Promise<BatchResult>
  cancel: () => Promise<void>
  onProgress: (callback: (progress: BatchProgress) => void) => () => void
  onComplete: (callback: (result: BatchResult) => void) => () => void
  selectZip: () => Promise<{ filePath: string; isEncrypted: boolean } | null>
  testZipPassword: (zipPath: string, password: string) => Promise<{ success: boolean }>
  extractZip: (zipPath: string, password?: string) => Promise<{ files: string[]; errors: string[] }>
  cleanupZipTemp: () => Promise<void>
}

export interface CohortAPI {
  getVariants: (
    params: CohortSearchParams
  ) => Promise<{ data: CohortVariant[]; total_count: number }>
  getSummary: () => Promise<CohortSummary>
  getCarriers: (chr: string, pos: number, ref: string, alt: string) => Promise<CohortCarrier[]>
  getGeneBurden: () => Promise<GeneBurden[]>
  getColumnMeta: () => Promise<ColumnFilterMeta[]>
  getSummaryStatus: () => Promise<{ is_stale: boolean; last_rebuilt_at: number }>
  rebuildSummary: () => Promise<void>
  onSummaryRebuilt: (callback: (status: { is_stale: boolean }) => void) => () => void
}

// Annotation update types
export interface GlobalAnnotationUpdates {
  global_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
  user_name?: string // for audit trail only
}

export interface PerCaseAnnotationUpdates {
  per_case_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
  user_name?: string // for audit trail only
}

export interface VariantKey {
  chr: string
  pos: number
  ref: string
  alt: string
}

export interface VariantAnnotationsResult {
  global: VariantAnnotation | null
  perCase: CaseVariantAnnotation | null
}

export interface AnnotationsAPI {
  getGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<VariantAnnotation | null>
  upsertGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates
  ) => Promise<VariantAnnotation>
  deleteGlobal: (chr: string, pos: number, ref: string, alt: string) => Promise<void>
  getPerCase: (caseId: number, variantId: number) => Promise<CaseVariantAnnotation | null>
  upsertPerCase: (
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ) => Promise<CaseVariantAnnotation>
  deletePerCase: (caseId: number, variantId: number) => Promise<void>
  getForVariant: (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<VariantAnnotationsResult>
  batchGet: (
    caseId: number | null,
    variantKeys: VariantKey[]
  ) => Promise<Record<string, VariantAnnotationsResult>>
}

export interface VepAPI {
  fetch: (chr: string, pos: number, ref: string, alt: string) => Promise<VepFetchResult>
  cancel: () => Promise<void>
  clearCache: () => Promise<{ success: boolean }>
  getCacheStats: () => Promise<CacheSizeInfo>
}

export interface HpoAPI {
  search: (query: string, maxResults?: number) => Promise<HpoSearchResult>
  clearCache: () => Promise<{ success: boolean }>
}

export interface MyVariantAPI {
  fetch: (chr: string, pos: number, ref: string, alt: string) => Promise<MyVariantFetchResult>
  clearCache: () => Promise<{ success: boolean }>
}

export interface SpliceAIAPI {
  fetch: (chr: string, pos: number, ref: string, alt: string) => Promise<SpliceAIFetchResult>
  clearCache: () => Promise<{ success: boolean }>
}

// Case metadata types
export interface CaseMetadataUpdates {
  affected_status?: AffectedStatus | null
  sex?: CaseSex | null
  notes?: string | null
  age?: number | null
  date_of_birth?: string | null
}

export interface FullCaseMetadata {
  metadata: CaseMetadata | null
  cohorts: CohortGroup[]
  hpoTerms: CaseHpoTerm[]
  comments: CaseComment[]
  metrics: CaseMetricWithDefinition[]
  dataInfo: CaseDataInfo | null
  externalIds: CaseExternalId[]
}

export interface CaseMetadataAPI {
  get: (caseId: number) => Promise<CaseMetadata | null>
  upsert: (caseId: number, updates: CaseMetadataUpdates) => Promise<CaseMetadata>
  getFullMetadata: (caseId: number) => Promise<FullCaseMetadata>

  // Cohort groups
  listCohorts: () => Promise<CohortGroup[]>
  createCohort: (name: string, description?: string | null) => Promise<CohortGroup>
  updateCohort: (
    cohortId: number,
    updates: { name?: string; description?: string | null }
  ) => Promise<CohortGroup>
  deleteCohort: (cohortId: number) => Promise<void>
  getCohortByName: (name: string) => Promise<CohortGroup | null>

  // Case-cohort links
  getCaseCohorts: (caseId: number) => Promise<CohortGroup[]>
  assignCohort: (caseId: number, cohortId: number) => Promise<void>
  removeCohort: (caseId: number, cohortId: number) => Promise<void>
  setCohorts: (caseId: number, cohortIds: number[]) => Promise<void>

  // HPO terms
  getHpoTerms: (caseId: number) => Promise<CaseHpoTerm[]>
  assignHpoTerm: (caseId: number, hpoId: string, hpoLabel: string) => Promise<CaseHpoTerm>
  removeHpoTerm: (caseId: number, hpoId: string) => Promise<void>

  // Data info (import provenance, platform, pre-filtering)
  getDataInfo: (caseId: number) => Promise<CaseDataInfo | null>
  upsertDataInfo: (caseId: number, updates: CaseDataInfoUpdates) => Promise<CaseDataInfo>

  // External IDs
  listExternalIds: (caseId: number) => Promise<CaseExternalId[]>
  upsertExternalId: (caseId: number, idType: string, idValue: string) => Promise<CaseExternalId>
  deleteExternalId: (caseId: number, idType: string) => Promise<void>
  distinctHpoTerms: () => Promise<Array<{ hpo_id: string; hpo_label: string }>>
  distinctPlatforms: () => Promise<string[]>
  distinctExternalIdTypes: () => Promise<string[]>
}

export interface CaseCommentsAPI {
  list: (caseId: number) => Promise<CaseComment[]>
  create: (caseId: number, category: CommentCategory, content: string) => Promise<CaseComment>
  update: (commentId: number, content: string) => Promise<CaseComment>
  delete: (commentId: number) => Promise<void>
}

export interface MetricValue {
  numeric_value?: number | null
  text_value?: string | null
  date_value?: string | null
}

export interface CaseMetricsAPI {
  listDefinitions: () => Promise<MetricDefinition[]>
  createDefinition: (
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ) => Promise<MetricDefinition>
  listForCase: (caseId: number) => Promise<CaseMetricWithDefinition[]>
  upsert: (caseId: number, metricId: number, value: MetricValue) => Promise<CaseMetric>
  delete: (caseId: number, metricId: number) => Promise<void>
}

export interface TagsAPI {
  // Tag CRUD
  list: () => Promise<Tag[]>
  create: (name: string, color: string) => Promise<Tag>
  update: (id: number, updates: { name?: string; color?: string }) => Promise<Tag>
  delete: (id: number) => Promise<void>
  getUsageCount: (tagId: number) => Promise<number>

  // Variant tag assignments
  getVariantTags: (caseId: number, variantId: number) => Promise<Tag[]>
  assignVariantTag: (caseId: number, variantId: number, tagId: number) => Promise<void>
  removeVariantTag: (caseId: number, variantId: number, tagId: number) => Promise<void>
  setVariantTags: (caseId: number, variantId: number, tagIds: number[]) => Promise<void>
}

export interface TranscriptsAPI {
  list: (variantId: number) => Promise<TranscriptAnnotation[]>
  switch: (variantId: number, transcriptId: string) => Promise<{ success: boolean }>
  insertAndSwitch: (
    variantId: number,
    transcript: TranscriptInsertRow
  ) => Promise<{ success: boolean }>
}

export interface LogsAPI {
  onMessage: (callback: (log: LogMessage) => void) => () => void
}

export interface AuditLogAPI {
  getByEntity: (entityKey: string) => Promise<AuditLogEntry[]>
  query: (params: {
    action_type?: string
    entity_type?: string
    entity_key?: string
    from_timestamp?: number
    to_timestamp?: number
    limit?: number
    offset?: number
  }) => Promise<{ data: AuditLogEntry[]; total_count: number }>
}

export interface GeneListsAPI {
  list: () => Promise<GeneListWithCount[]>
  create: (name: string, description?: string | null) => Promise<GeneList>
  delete: (id: number) => Promise<void>
  getGenes: (listId: number) => Promise<string[]>
  setGenes: (listId: number, genes: string[]) => Promise<string[]>
}

export interface RegionFilesAPI {
  list: () => Promise<RegionFile[]>
  create: (name: string, description: string | null) => Promise<RegionFile>
  delete: (id: number) => Promise<void>
  importBed: (fileId: number, filePath: string) => Promise<RegionFile>
}

export interface PanelsAPI {
  list: () => Promise<PanelWithCount[]>
  get: (id: number) => Promise<(PanelRow & { genes: PanelGeneRow[] }) | null>
  create: (params: {
    name: string
    description?: string | null
    version?: string | null
    source?: string
    sourceId?: string | null
    sourceMetadata?: Record<string, unknown> | null
  }) => Promise<PanelRow>
  update: (params: {
    id: number
    name?: string
    description?: string | null
    version?: string | null
  }) => Promise<PanelRow>
  delete: (id: number) => Promise<{ success: boolean }>
  duplicate: (id: number, newName: string) => Promise<PanelRow>
  setGenes: (
    panelId: number,
    genes: Array<{ hgncId: string; symbol: string }>
  ) => Promise<{ success: boolean }>
  getGenes: (panelId: number) => Promise<PanelGeneRow[]>
  activate: (caseId: number, panelId: number, paddingBp?: number) => Promise<{ success: boolean }>
  deactivate: (caseId: number, panelId: number) => Promise<{ success: boolean }>
  activeForCase: (caseId: number) => Promise<ActivePanelRow[]>
  validateSymbols: (symbols: string[]) => Promise<GeneValidationResult[]>
  autocomplete: (query: string, limit?: number) => Promise<GeneAutocompleteResult[]>
  searchPanelApp: (
    keyword: string,
    region: 'uk' | 'aus' | 'both'
  ) => Promise<PanelAppSearchResult[]>
  importPanelApp: (params: {
    panelId: number
    region: 'uk' | 'aus'
    confidenceThreshold: 'green' | 'green_amber' | 'all'
    name?: string
  }) => Promise<PanelRow>
  generateStringDb: (params: {
    seedGenes: string[]
    requiredScore: number
    networkType: 'physical' | 'functional'
    name?: string
  }) => Promise<PanelRow>
  exportBed: (
    panelId: number,
    assembly: string,
    paddingBp: number
  ) => Promise<{ success: boolean; path?: string }>
}

export interface GeneRefCheckUpdatesResult {
  currentBuiltAt: number
  daysSinceBuilt: number
  needsUpdate: boolean
}

export interface GeneRefUpdateResult {
  success: boolean
  message: string
}

export interface GeneRefAPI {
  info: () => Promise<GeneRefInfo>
  assemblies: () => Promise<AssemblyInfo[]>
  checkUpdates: () => Promise<GeneRefCheckUpdatesResult>
  update: () => Promise<GeneRefUpdateResult>
}

export interface AnalysisGroup {
  id: number
  name: string
  group_type: string
  description: string | null
  created_at: number
  updated_at: number
}

export interface AnalysisGroupMember {
  id: number
  group_id: number
  case_id: number
  role: string
  affected_status: string
  individual_id: string | null
}

export interface AnalysisGroupsAPI {
  list: () => Promise<AnalysisGroup[]>
  get: (id: number) => Promise<AnalysisGroup & { members: AnalysisGroupMember[] }>
  create: (params: {
    name: string
    groupType?: string
    description?: string
  }) => Promise<AnalysisGroup>
  update: (id: number, params: { name?: string; description?: string }) => Promise<AnalysisGroup>
  delete: (id: number) => Promise<void>
  addMember: (params: {
    groupId: number
    caseId: number
    role: string
    affectedStatus?: string
    individualId?: string
  }) => Promise<AnalysisGroupMember>
  removeMember: (groupId: number, caseId: number) => Promise<void>
  getForCase: (caseId: number) => Promise<AnalysisGroup | null>
}

export interface ProteinAPI {
  getMapping: (geneSymbol: string) => Promise<ProteinMappingResult | ProteinApiError>
  getDomains: (uniprotAccession: string) => Promise<ProteinDomainResult | ProteinApiError>
  getStructure: (uniprotAccession: string) => Promise<ProteinStructureResult | ProteinApiError>
  getGeneStructure: (geneSymbol: string) => Promise<GeneStructureResult | ProteinApiError>
}

export interface GnomadAPI {
  getVariants: (
    geneSymbol: string,
    dataset?: string
  ) => Promise<GnomadFetchResult | ProteinApiError>
  getClinVarVariants: (
    geneSymbol: string,
    dataset?: string
  ) => Promise<ClinVarFetchResult | ProteinApiError>
}

export interface WindowAPI {
  cases: CasesAPI
  variants: VariantsAPI
  import: ImportAPI
  system: SystemAPI
  export: ExportAPI
  shell: ShellAPI
  database: DatabaseAPI
  batchImport: BatchImportAPI
  cohort: CohortAPI
  annotations: AnnotationsAPI
  vep: VepAPI
  hpo: HpoAPI
  myvariant: MyVariantAPI
  spliceai: SpliceAIAPI
  caseMetadata: CaseMetadataAPI
  caseComments: CaseCommentsAPI
  caseMetrics: CaseMetricsAPI
  transcripts: TranscriptsAPI
  tags: TagsAPI
  logs: LogsAPI
  geneLists: GeneListsAPI
  regionFiles: RegionFilesAPI
  updater: UpdaterAPI
  audit: AuditLogAPI
  auth: AuthAPI
  presets: PresetsAPI
  panels: PanelsAPI
  geneRef: GeneRefAPI
  analysisGroups: AnalysisGroupsAPI
  protein: ProteinAPI
  gnomad: GnomadAPI
}

export interface PresetsAPI {
  list: () => Promise<FilterPreset[]>
  create: (params: FilterPresetCreate) => Promise<FilterPreset>
  update: (id: number, updates: FilterPresetUpdate) => Promise<FilterPreset>
  delete: (id: number) => Promise<void>
  reorder: (items: { id: number; sortOrder: number }[]) => Promise<void>
}

export interface AuthAPI {
  login: (
    username: string,
    password: string
  ) => Promise<{
    success: boolean
    user?: { id: number; username: string; role: string }
    mustChangePassword?: boolean
    locked?: boolean
  }>
  logout: () => Promise<void>
  currentUser: () => Promise<{ id: number; username: string; role: string } | null>
  isAccountsEnabled: () => Promise<boolean>
  createUser: (username: string, displayName: string, tempPassword: string) => Promise<void>
  listUsers: () => Promise<
    Array<{
      id: number
      username: string
      display_name: string | null
      role: string
      is_active: number
      must_change_password: number
      failed_login_count: number
      created_at: string
    }>
  >
  deactivateUser: (username: string) => Promise<void>
  resetPassword: (username: string, newPassword: string) => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
}
