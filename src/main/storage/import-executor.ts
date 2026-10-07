import type { MultiFileImportSpec } from '../../shared/types/api'

export interface StorageImportVcfOptions {
  selectedSample?: string
  genomeBuild?: string
}

/**
 * Storage-layer progress event. Intentionally narrower than the
 * import-logic ImportCallbacks.onProgress payload, which carries
 * additional fileIndex / totalFiles / filePath / fileName fields used by
 * the renderer for per-file attribution in multi-file imports. Storage
 * callers that need that attribution must subscribe at the IPC layer
 * directly (Lane F dispatch in Task 13).
 */
export interface StorageImportProgress {
  phase: string
  count: number
  elapsed: number
  skipped: number
}

export interface StorageImportSingleFileParams {
  filePath: string
  caseName: string
  vcfOptions?: StorageImportVcfOptions
  throttleMs: number
  onProgress?: (data: StorageImportProgress) => void
  /**
   * SQLite: the import worker stopped keeping the cohort summary current. The
   * summary is flagged stale from here until a rebuild — the worker's own at
   * the end of the import, or the caller's afterwards. At most once.
   */
  onSummaryStale?: () => void
}

export interface StorageImportSingleFileResult {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[]
  elapsed: number
}

/**
 * Storage-layer filter knobs for multi-file import. The IPC layer
 * (`ImportFiltersIpcPayload` in `src/main/ipc/handlers/import.ts`) uses
 * `bedFile`; Task 13's import-logic.ts translates that into `bedFilePath`
 * here. Naming differs because the IPC payload reflects the UI's "selected
 * file" semantic while the storage/worker layer always works with absolute
 * filesystem paths.
 */
export interface StorageImportFileFilters {
  bedFilePath?: string | null
  bedPadding?: number
  passOnly?: boolean
  minQual?: number | null
  minGq?: number | null
  minDp?: number | null
}

export interface ImportFileCompleteEvent {
  filePath: string
  caseId: number
  variantCount: number
}

export interface StorageImportMultiFileParams {
  caseName: string
  files: MultiFileImportSpec[]
  vcfOptions?: StorageImportVcfOptions
  filters?: StorageImportFileFilters
  throttleMs?: number
  onProgress?: (data: StorageImportProgress) => void
  onFileComplete?: (event: ImportFileCompleteEvent) => void
}

export interface StorageImportMultiFileResult {
  caseId: number
  variantCount: number
  files: Array<{
    filePath: string
    variantType: string
    variantCount: number
    error?: string
  }>
  skipped: number
  /**
   * Top-level errors reserved for import-orchestrator failures (e.g., the
   * import session itself could not start). Per-file failures live in
   * `files[].error`. Both backends should keep this empty unless a
   * non-file-scoped error occurred.
   */
  errors: string[]
  elapsed: number
}

/**
 * An open batch: one exclusive import operation on the workspace whose files
 * may be imported concurrently. Each file still becomes visible atomically,
 * on its own, as soon as it is done.
 */
export interface StorageImportBatch {
  importFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  /** Ask every file in flight to stop. Their `importFile` promises reject. */
  cancelAll(): void
  /** Wait for nothing: call once every `importFile` promise has settled. Cleans up and releases the workspace. */
  close(): Promise<void>
}

export interface StorageImportExecutor {
  importSingleFile(params: StorageImportSingleFileParams): Promise<StorageImportSingleFileResult>
  importMultiFile(params: StorageImportMultiFileParams): Promise<StorageImportMultiFileResult>
  cancel(): void
  /**
   * Open a batch for concurrent file imports. Absent on backends that write
   * through a single connection; callers then import the files one by one.
   * Rejects with a conflict when another import already holds the workspace.
   */
  openBatch?(): Promise<StorageImportBatch>
}
