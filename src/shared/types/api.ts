// Auto-update types
export type UpdateState =
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

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
} from './database'
import type { ProgressUpdate, ImportResult, VcfPreviewResult } from './import'
import type { IpcResult } from './errors'
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
import type { ShortlistResult } from './shortlist'
import type { ValidatedGetShortlistParams } from './ipc-schemas'
import type { LogMessage } from './log'
import type { TranscriptAnnotation, TranscriptInsertRow } from './transcript'
import type {
  GeneValidationResult,
  GeneAutocompleteResult,
  GeneRefInfo,
  AssemblyInfo
} from './gene-reference'
import type {
  PanelRow,
  PanelWithCount,
  PanelGeneRow,
  ActivePanelRow,
  PanelAppSearchResult
} from './panels'
import type {
  ProteinMappingResult,
  ProteinDomainResult,
  ProteinStructureResult,
  GeneStructureResult,
  GnomadFetchResult,
  ClinVarFetchResult,
  ProteinApiError
} from './protein'
import type { PerfSnapshot } from './perf'
import type { CasesDomainContract } from '../ipc/domains/cases'
import type { DatabaseDomainContract } from '../ipc/domains/database'
import type { DebugApi } from '../ipc/domains/debug'
import type { JobsApi } from '../ipc/domains/jobs'
export type { DatabaseInfo, DatabaseOpenResult, RecentDatabase } from '../ipc/domains/database'

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

export type CasesAPI = CasesDomainContract

export interface VariantsAPI {
  query: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    offset?: number,
    limit?: number,
    sortBy?: SortItem[],
    skipCount?: boolean,
    includeUnfilteredCount?: boolean
  ) => Promise<IpcResult<PaginatedResult<Variant> & { unfiltered_count?: number }>>
  getFilterOptions: (caseId: number) => Promise<IpcResult<FilterOptions>>
  search: (caseId: number, query: string, limit?: number) => Promise<IpcResult<Variant[]>>
  geneSymbols: (caseId: number, query: string, limit?: number) => Promise<IpcResult<string[]>>
  /** Get variant type counts per case for tab badges (snv/indel/sv/cnv/str) */
  typeCounts: (caseId: number) => Promise<IpcResult<Record<string, number>>>
  /**
   * Get per-column metadata for a single column (single-case or cohort scope).
   * Used by the filter UI to lazy-load metadata on demand instead of bulk
   * fetching every column via `getFilterOptions`. Either `caseId` or a
   * non-empty `caseIds` array must be provided.
   */
  columnMeta: (payload: {
    caseId?: number
    caseIds?: number[]
    columnKey: string
  }) => Promise<IpcResult<ColumnFilterMeta>>
  /**
   * Get distinct variant types present for a single case or cohort. Used by
   * the renderer to auto-hide variant-type tabs with no data. Either `caseId`
   * or a non-empty `caseIds` array must be provided.
   */
  typesPresent: (payload: { caseId?: number; caseIds?: number[] }) => Promise<IpcResult<string[]>>
  /**
   * Run the unified shortlist pipeline for a case. Wave 3 wrapper around the
   * `variants:shortlist` IPC channel. Accepts either a preset id or an
   * inline `adHocConfig` (discriminated union) and resolves to the ranked
   * `ShortlistResult` envelope.
   */
  shortlist: (params: ValidatedGetShortlistParams) => Promise<ShortlistResult>
  /**
   * Subscribe to `variants:annotationChanged` broadcasts. Returns an
   * unsubscribe function. Emitted only on per-case annotation upserts in
   * Phase 1 (global upserts do NOT fire this event). Consumers (e.g. Wave 4
   * `useShortlistQuery`) use this to refetch dependent views when the
   * same-case star / ACMG state changes.
   */
  onAnnotationChanged: (callback: (ev: AnnotationChangeEvent) => void) => () => void
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

export interface MultiFileImportSpec {
  filePath: string
  variantType: string
  caller: string | null
  annotationFormat: string | null
}

export interface MultiFileImportFileResult {
  filePath: string
  variantType: string
  variantCount: number
  error?: string
}

export interface MultiFileImportResult {
  caseId: number
  totalVariants: number
  totalSkipped: number
  files: MultiFileImportFileResult[]
  elapsed: number
}

export interface ImportAPI {
  selectFile: () => Promise<string | null>
  selectFiles: () => Promise<string[]>
  selectBedFile: () => Promise<string | null>
  start: (
    filePath: string,
    caseName: string,
    vcfOptions?: { selectedSample?: string; genomeBuild?: string }
  ) => Promise<IpcResult<ImportResult>>
  startMultiFile: (
    caseName: string,
    files: MultiFileImportSpec[],
    vcfOptions?: { selectedSample?: string; genomeBuild?: string },
    filters?: {
      bedFile?: string | null
      bedPadding?: number
      passOnly?: boolean
      minQual?: number | null
      minGq?: number | null
      minDp?: number | null
    }
  ) => Promise<IpcResult<MultiFileImportResult>>
  vcfPreview: (filePath: string) => Promise<VcfPreviewResult>
  vcfMultiPreview: (
    filePaths: string[]
  ) => Promise<IpcResult<import('./import').VcfMultiPreviewResult>>
  onProgress: (callback: (progress: ProgressUpdate) => void) => () => void
  cancel: () => Promise<void>
}

export interface SystemAPI {
  getVersion: () => Promise<{ app: string; electron: string }>
  getUserDataPath: () => Promise<string>
  getCpuCount: () => Promise<number>
  setWorkerThreads: (count: number) => Promise<void>
  getWorkerThreads: () => Promise<number>
  getLogFilePath: () => Promise<string>
}

export interface ShellOpenExternalResult {
  success: boolean
  error?: string
}

export interface ShellAPI {
  openExternal: (url: string) => Promise<ShellOpenExternalResult>
  showItemInFolder: (filePath: string) => Promise<void>
  updateDomains: (domains: string[]) => Promise<void>
}

/** Successful export result */
export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

export interface ExportAPI {
  variants: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    caseName: string
  ) => Promise<IpcResult<ExportResult>>
  cohort: (params: CohortSearchParams) => Promise<IpcResult<ExportResult>>
}

export type DatabaseAPI = DatabaseDomainContract

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
  checkDuplicates: (
    filePaths: string[],
    stripText?: string
  ) => Promise<IpcResult<DuplicateCheckResult>>
  start: (
    filePaths: string[],
    duplicateStrategy: DuplicateChoice,
    stripText?: string
  ) => Promise<IpcResult<BatchResult>>
  cancel: () => Promise<IpcResult<void>>
  onProgress: (callback: (progress: BatchProgress) => void) => () => void
  onComplete: (callback: (result: BatchResult) => void) => () => void
  selectZip: () => Promise<IpcResult<{ filePath: string; isEncrypted: boolean } | null>>
  testZipPassword: (zipPath: string, password: string) => Promise<IpcResult<{ success: boolean }>>
  extractZip: (
    zipPath: string,
    password?: string
  ) => Promise<IpcResult<{ files: string[]; errors: string[] }>>
  cleanupZipTemp: () => Promise<IpcResult<void>>
}

export interface CohortAPI {
  getVariants: (params: CohortSearchParams) => Promise<
    IpcResult<{
      data: CohortVariant[]
      total_count: number
      /** Optional same-load read warnings (Sprint A PR-3 C5). */
      warnings?: { staleSummary?: boolean }
    }>
  >
  getSummary: () => Promise<IpcResult<CohortSummary>>
  getCarriers: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<CohortCarrier[]>>
  getGeneBurden: () => Promise<IpcResult<GeneBurden[]>>
  getColumnMeta: () => Promise<IpcResult<ColumnFilterMeta[]>>
  getSummaryStatus: () => Promise<IpcResult<{ is_stale: boolean; last_rebuilt_at: number }>>
  rebuildSummary: () => Promise<void>
  /**
   * Subscribe to cohort summary rebuild events.
   *
   * The status payload includes `is_stale` (required) plus optional phase
   * progress fields. Phase events are emitted between SQL statements inside
   * the rebuild worker (see `src/main/workers/rebuild-summary-worker.ts`):
   *
   * - When a rebuild starts → `{ is_stale: true }`
   * - For each phase boundary → `{ is_stale: true, phase, phase_index, phase_total, label }`
   * - When a rebuild finishes → `{ is_stale: false }`
   *
   * Subscribers that only read `is_stale` stay correct; subscribers that
   * want phase progress read the optional fields.
   */
  onSummaryRebuilt: (
    callback: (status: {
      is_stale: boolean
      phase?: string
      phase_index?: number
      phase_total?: number
      label?: string
    }) => void
  ) => () => void
  runAssociation: (config: unknown) => Promise<IpcResult<unknown>>
  cancelAssociation: () => Promise<void>
  onAssociationProgress: (
    callback: (progress: { completed: number; total: number }) => void
  ) => () => void
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

/**
 * Batched annotation lookup key (Sprint A A1, Pass-8 #1).
 *
 * `variantId` is OPTIONAL. The cohort/global batch path omits it; the per-case
 * path includes it for the defensive join (Pass-8 #2). Renderer code MUST pass
 * `variantId` when `caseId !== null`; the server-side join validates that the
 * `variantId` actually belongs to `caseId` — a spoofed `variantId` returns null.
 */
export type BatchAnnotationKey = VariantKey & { variantId?: number }

export interface PublicAnnotationSnapshotSummary {
  snapshotId: string
  bundleId: string | null
  genomeBuild: string | null
  mappingVersion: string
  contentHash: string
  manifestChecksum: string
  licenseMatrixChecksum: string
  publicFileCount: number
  privateCaseData: boolean
  ingestedAt: string | null
}

export interface PublicAnnotationVariantRecord {
  snapshotId: string
  sourceId: string | null
  fieldName: string
  fieldValue: unknown
  evidence: unknown
  provenance: unknown
}

export interface PublicAnnotationReferences {
  snapshots: PublicAnnotationSnapshotSummary[]
  variantRecords: PublicAnnotationVariantRecord[]
}

/**
 * B4a: the released public snapshot list is identical for every variant in a batch,
 * so it is hoisted to a single top-level `snapshots` field instead of being repeated
 * under each variant key (which duplicated it across the IPC/JSON payload).
 */
export interface PublicAnnotationBatchReferences {
  snapshots: PublicAnnotationSnapshotSummary[]
  byVariant: Record<string, { variantRecords: PublicAnnotationVariantRecord[] }>
}

export interface VariantAnnotationsResult {
  global: VariantAnnotation | null
  perCase: CaseVariantAnnotation | null
  publicReferences?: PublicAnnotationReferences
}

export interface AnnotationsAPI {
  getGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<VariantAnnotation | null>>
  upsertGlobal: (
    chr: string,
    pos: number,
    ref: string,
    alt: string,
    updates: GlobalAnnotationUpdates
  ) => Promise<IpcResult<VariantAnnotation>>
  deleteGlobal: (chr: string, pos: number, ref: string, alt: string) => Promise<IpcResult<void>>
  getPerCase: (
    caseId: number,
    variantId: number
  ) => Promise<IpcResult<CaseVariantAnnotation | null>>
  upsertPerCase: (
    caseId: number,
    variantId: number,
    updates: PerCaseAnnotationUpdates
  ) => Promise<IpcResult<CaseVariantAnnotation>>
  deletePerCase: (caseId: number, variantId: number) => Promise<IpcResult<void>>
  getForVariant: (
    caseId: number,
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<VariantAnnotationsResult>>
  batchGet: (
    caseId: number | null,
    variantKeys: VariantKey[]
  ) => Promise<IpcResult<Record<string, VariantAnnotationsResult>>>
}

export interface VepAPI {
  fetch: (chr: string, pos: number, ref: string, alt: string) => Promise<IpcResult<VepFetchResult>>
  cancel: () => Promise<IpcResult<void>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
  getCacheStats: () => Promise<IpcResult<CacheSizeInfo>>
}

export interface HpoAPI {
  search: (query: string, maxResults?: number) => Promise<IpcResult<HpoSearchResult>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
}

export interface MyVariantAPI {
  fetch: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<MyVariantFetchResult>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
}

export interface SpliceAIAPI {
  fetch: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => Promise<IpcResult<SpliceAIFetchResult>>
  clearCache: () => Promise<IpcResult<{ success: boolean }>>
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
  get: (caseId: number) => Promise<IpcResult<CaseMetadata | null>>
  upsert: (caseId: number, updates: CaseMetadataUpdates) => Promise<CaseMetadata>
  getFullMetadata: (caseId: number) => Promise<IpcResult<FullCaseMetadata>>

  // Cohort groups
  listCohorts: () => Promise<IpcResult<CohortGroup[]>>
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
  list: (caseId: number) => Promise<IpcResult<CaseComment[]>>
  create: (
    caseId: number,
    category: CommentCategory,
    content: string
  ) => Promise<IpcResult<CaseComment>>
  update: (commentId: number, content: string) => Promise<IpcResult<CaseComment>>
  delete: (commentId: number) => Promise<IpcResult<void>>
}

export interface MetricValue {
  numeric_value?: number | null
  text_value?: string | null
  date_value?: string | null
}

export interface CaseMetricsAPI {
  listDefinitions: () => Promise<IpcResult<MetricDefinition[]>>
  createDefinition: (
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ) => Promise<IpcResult<MetricDefinition>>
  listForCase: (caseId: number) => Promise<IpcResult<CaseMetricWithDefinition[]>>
  upsert: (caseId: number, metricId: number, value: MetricValue) => Promise<IpcResult<CaseMetric>>
  delete: (caseId: number, metricId: number) => Promise<IpcResult<void>>
}

export interface TagsAPI {
  // Tag CRUD
  list: () => Promise<IpcResult<Tag[]>>
  create: (name: string, color: string) => Promise<IpcResult<Tag>>
  update: (id: number, updates: { name?: string; color?: string }) => Promise<IpcResult<Tag>>
  delete: (id: number) => Promise<IpcResult<void>>
  getUsageCount: (tagId: number) => Promise<IpcResult<number>>

  // Variant tag assignments
  getVariantTags: (caseId: number, variantId: number) => Promise<IpcResult<Tag[]>>
  assignVariantTag: (caseId: number, variantId: number, tagId: number) => Promise<IpcResult<void>>
  removeVariantTag: (caseId: number, variantId: number, tagId: number) => Promise<IpcResult<void>>
  setVariantTags: (caseId: number, variantId: number, tagIds: number[]) => Promise<IpcResult<void>>
}

export interface TranscriptsAPI {
  list: (variantId: number) => Promise<IpcResult<TranscriptAnnotation[]>>
  switch: (variantId: number, transcriptId: string) => Promise<IpcResult<{ success: boolean }>>
  insertAndSwitch: (
    variantId: number,
    transcript: TranscriptInsertRow
  ) => Promise<IpcResult<{ success: boolean }>>
}

export interface LogsAPI {
  onMessage: (callback: (log: LogMessage) => void) => () => void
}

export interface AuditLogAPI {
  getByEntity: (entityKey: string) => Promise<IpcResult<AuditLogEntry[]>>
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
  list: () => Promise<IpcResult<GeneListWithCount[]>>
  create: (name: string, description?: string | null) => Promise<IpcResult<GeneList>>
  delete: (id: number) => Promise<IpcResult<void>>
  getGenes: (listId: number) => Promise<IpcResult<string[]>>
  setGenes: (listId: number, genes: string[]) => Promise<IpcResult<string[]>>
}

export interface RegionFilesAPI {
  list: () => Promise<RegionFile[]>
  create: (name: string, description: string | null) => Promise<RegionFile>
  delete: (id: number) => Promise<void>
  importBed: (fileId: number, filePath: string) => Promise<RegionFile>
}

export interface PanelsAPI {
  list: () => Promise<IpcResult<PanelWithCount[]>>
  get: (id: number) => Promise<IpcResult<(PanelRow & { genes: PanelGeneRow[] }) | null>>
  create: (params: {
    name: string
    description?: string | null
    version?: string | null
    source?: string
    sourceId?: string | null
    sourceMetadata?: Record<string, unknown> | null
  }) => Promise<IpcResult<PanelRow>>
  update: (params: {
    id: number
    name?: string
    description?: string | null
    version?: string | null
  }) => Promise<IpcResult<PanelRow>>
  delete: (id: number) => Promise<IpcResult<{ success: boolean }>>
  duplicate: (id: number, newName: string) => Promise<IpcResult<PanelRow>>
  setGenes: (
    panelId: number,
    genes: Array<{ hgncId: string; symbol: string }>
  ) => Promise<IpcResult<{ success: boolean }>>
  getGenes: (panelId: number) => Promise<IpcResult<PanelGeneRow[]>>
  activate: (
    caseId: number,
    panelId: number,
    paddingBp?: number
  ) => Promise<IpcResult<{ success: boolean }>>
  deactivate: (caseId: number, panelId: number) => Promise<IpcResult<{ success: boolean }>>
  activeForCase: (caseId: number) => Promise<IpcResult<ActivePanelRow[]>>
  validateSymbols: (symbols: string[]) => Promise<IpcResult<GeneValidationResult[]>>
  autocomplete: (query: string, limit?: number) => Promise<IpcResult<GeneAutocompleteResult[]>>
  searchPanelApp: (
    keyword: string,
    region: 'uk' | 'aus' | 'both'
  ) => Promise<IpcResult<PanelAppSearchResult[]>>
  importPanelApp: (params: {
    panelId: number
    region: 'uk' | 'aus'
    confidenceThreshold: 'green' | 'green_amber' | 'all'
    name?: string
  }) => Promise<IpcResult<PanelRow>>
  generateStringDb: (params: {
    seedGenes: string[]
    requiredScore: number
    networkType: 'physical' | 'functional'
    name?: string
  }) => Promise<IpcResult<PanelRow>>
  exportBed: (
    panelId: number,
    assembly: string,
    paddingBp: number
  ) => Promise<IpcResult<{ success: boolean; path?: string }>>
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
  info: () => Promise<IpcResult<GeneRefInfo>>
  assemblies: () => Promise<IpcResult<AssemblyInfo[]>>
  checkUpdates: () => Promise<IpcResult<GeneRefCheckUpdatesResult>>
  update: () => Promise<IpcResult<GeneRefUpdateResult>>
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
  list: () => Promise<IpcResult<AnalysisGroup[]>>
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
  getMapping: (geneSymbol: string) => Promise<IpcResult<ProteinMappingResult | ProteinApiError>>
  getDomains: (
    uniprotAccession: string
  ) => Promise<IpcResult<ProteinDomainResult | ProteinApiError>>
  getStructure: (
    uniprotAccession: string
  ) => Promise<IpcResult<ProteinStructureResult | ProteinApiError>>
  getGeneStructure: (
    geneSymbol: string
  ) => Promise<IpcResult<GeneStructureResult | ProteinApiError>>
}

export interface GnomadAPI {
  getVariants: (
    geneSymbol: string,
    dataset?: string
  ) => Promise<IpcResult<GnomadFetchResult | ProteinApiError>>
  getClinVarVariants: (
    geneSymbol: string,
    dataset?: string
  ) => Promise<IpcResult<ClinVarFetchResult | ProteinApiError>>
}

export interface PerfAPI {
  reportInteractive: () => void
  getSnapshot: () => Promise<PerfSnapshot>
  resetSnapshot: () => Promise<void>
  isEnabled: () => boolean
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
  perf: PerfAPI
  debug: DebugAPI
  jobs: JobsAPI
}

export type DebugAPI = DebugApi

export type JobsAPI = JobsApi

export interface PresetsAPI {
  list: () => Promise<IpcResult<FilterPreset[]>>
  create: (params: FilterPresetCreate) => Promise<IpcResult<FilterPreset>>
  update: (id: number, updates: FilterPresetUpdate) => Promise<IpcResult<FilterPreset>>
  delete: (id: number) => Promise<IpcResult<void>>
  reorder: (items: { id: number; sortOrder: number }[]) => Promise<IpcResult<void>>
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
  currentUser: () => Promise<IpcResult<{ id: number; username: string; role: string } | null>>
  isAccountsEnabled: () => Promise<IpcResult<boolean>>
  createUser: (
    username: string,
    displayName: string,
    tempPassword: string
  ) => Promise<IpcResult<void>>
  listUsers: () => Promise<
    IpcResult<
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
  >
  deactivateUser: (username: string) => Promise<IpcResult<void>>
  resetPassword: (username: string, newPassword: string) => Promise<IpcResult<void>>
  changePassword: (oldPassword: string, newPassword: string) => Promise<IpcResult<void>>
}

/**
 * Broadcast payload for the `variants:annotationChanged` event.
 *
 * Emitted by the main process whenever an annotation mutation (star,
 * comment, ACMG classification, evidence update) is persisted so that
 * the renderer can refetch dependent views (e.g. the Shortlist tab,
 * which needs to re-score when star or ACMG state changes).
 */
export interface AnnotationChangeEvent {
  caseId: number
  variantId: number
  kind: 'star' | 'comment' | 'acmg' | 'evidence'
}
