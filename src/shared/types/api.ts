// Import database and import types for reuse
import type {
  Case,
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem,
  VariantAnnotation,
  CaseVariantAnnotation,
  AcmgClassification,
  CaseMetadata,
  CohortGroup,
  CaseHpoTerm
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
import type { VepFetchResult, HpoSearchResult, CacheSizeInfo, CacheInfo } from './api-enrichment'

// Re-export for convenience
export type {
  Case,
  Variant,
  VariantFilter,
  PaginationCursor,
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
  CaseHpoTerm
}

export interface CasesAPI {
  list: () => Promise<Case[]>
  delete: (id: number) => Promise<void>
}

export interface VariantsAPI {
  query: (
    caseId: number,
    filters: Omit<VariantFilter, 'case_id'>,
    cursor?: PaginationCursor,
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
  checkDuplicates: (filePaths: string[]) => Promise<DuplicateCheckResult>
  start: (filePaths: string[], duplicateStrategy: DuplicateChoice) => Promise<BatchResult>
  cancel: () => Promise<void>
  onProgress: (callback: (progress: BatchProgress) => void) => () => void
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
}

// Annotation update types
export interface GlobalAnnotationUpdates {
  global_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
}

export interface PerCaseAnnotationUpdates {
  per_case_comment?: string | null
  starred?: boolean
  acmg_classification?: AcmgClassification | null
  acmg_evidence?: string | null
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

// Case metadata types
export type AffectedStatus = 'affected' | 'unaffected' | 'unknown'

export interface CaseMetadataUpdates {
  affected_status?: AffectedStatus | null
  notes?: string | null
}

export interface FullCaseMetadata {
  metadata: CaseMetadata | null
  cohorts: CohortGroup[]
  hpoTerms: CaseHpoTerm[]
}

export interface CaseMetadataAPI {
  get: (caseId: number) => Promise<CaseMetadata | null>
  upsert: (caseId: number, updates: CaseMetadataUpdates) => Promise<CaseMetadata>
  getFullMetadata: (caseId: number) => Promise<FullCaseMetadata>

  // Cohort groups
  listCohorts: () => Promise<CohortGroup[]>
  createCohort: (name: string, description?: string | null) => Promise<CohortGroup>
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
  caseMetadata: CaseMetadataAPI
}
