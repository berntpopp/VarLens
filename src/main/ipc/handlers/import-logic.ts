/**
 * Pure business logic for import IPC handlers.
 *
 * All functions take explicit dependencies (session, db, callbacks) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 *
 * As of PostgreSQL parity Phase 9, `startImport` routes through the active
 * `StorageSession`'s `StorageImportExecutor` for both SQLite and PostgreSQL
 * backends (including VCF files). `startMultiFileImport` is now backend-aware:
 * PostgreSQL sessions dispatch through `executor.importMultiFile()`; SQLite
 * sessions continue through the existing append pipeline
 * (`startMultiFileImportSqlite`).
 */
import { statSync } from 'node:fs'
import { mainLogger } from '../../services/MainLogger'
import { importDataReport, mergeUnrankedClinvar } from '../../import/unranked-clinvar'
import { ConflictError } from '../errors'
import { API_CONFIG } from '../../../shared/config/api.config'
import type { DatabaseService } from '../../database/DatabaseService'
import {
  createCohortStaleAnnouncer,
  settleAfterWorkerImport,
  type EmitCohortStale
} from './cohort-summary-settle'
import { assertGenomeBuildMatches, resolveCaseSample } from '../../import/vcf/vcf-header-parser'
import type {
  StorageImportFileFilters,
  StorageImportVcfOptions
} from '../../storage/import-executor'
import type { ImportDataReport } from '../../../shared/types/import'
import type { StorageSession } from '../../storage/session'
import { SqliteImportExecutor } from '../../storage/sqlite/SqliteImportExecutor'

/**
 * Serializable filter payload as sent from the renderer over IPC.
 * Mirrors `ImportFiltersIpcPayload` in `import.ts` — kept here so
 * `startMultiFileImport` can translate directly without requiring callers
 * to pre-build an `ImportFilters` (which loses the BED file path).
 */
export interface ImportFiltersPayload {
  bedFile?: string | null
  bedPadding?: number
  passOnly?: boolean
  minQual?: number | null
  minGq?: number | null
  minDp?: number | null
}

/**
 * Translate a raw IPC filter payload into `StorageImportFileFilters`.
 *
 * The IPC payload uses `bedFile` (path string); the storage/worker layer
 * uses `bedFilePath`. All other fields are passed through verbatim.
 */
function translateFiltersPayloadToStorage(payload: ImportFiltersPayload): StorageImportFileFilters {
  return {
    bedFilePath: payload.bedFile ?? null,
    bedPadding: payload.bedPadding,
    passOnly: payload.passOnly,
    minQual: payload.minQual,
    minGq: payload.minGq,
    minDp: payload.minDp
  }
}

/** Callbacks for emitting events to the renderer during import operations. */
export interface ImportCallbacks {
  onProgress?: (data: {
    phase: string
    count: number
    elapsed: number
    skipped: number
    // Multi-file session metadata — set by `startMultiFileImport` per file
    // so the renderer can attribute progress events to the correct file
    // without heuristics.
    fileIndex?: number
    totalFiles?: number
    filePath?: string
    fileName?: string
  }) => void
  /**
   * The cohort summary is out of date, being rebuilt, current again: when the
   * import worker stops keeping it current mid-import, and around the rebuild
   * that follows a multi-file append.
   */
  onCohortStale?: EmitCohortStale
}

/** Result of a successful import. */
export interface ImportResult extends ImportDataReport {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[]
  elapsed: number
}

/** Options for VCF import; `fieldProfile` applies to JSON imports too. */
export type VcfImportOptions = StorageImportVcfOptions

interface ActiveImportOperation {
  cancel: () => void
}

// Keep the full operation (not only a worker client) reachable for cancellation.
let activeImportOperation: ActiveImportOperation | null = null

/**
 * Run `operation` as THE import operation of this process: a second one is
 * refused with a conflict, and `cancelImport` reaches it through `cancel`.
 */
export async function withActiveImportOperation<T>(
  cancel: () => void,
  operation: () => Promise<T>
): Promise<T> {
  if (activeImportOperation !== null) {
    throw new ConflictError('An import operation is already in progress')
  }
  const current = { cancel }
  activeImportOperation = current
  try {
    return await operation()
  } finally {
    if (activeImportOperation === current) activeImportOperation = null
  }
}

/**
 * Start a single-file import through the active storage session's executor.
 *
 * The session abstracts SQLite vs PostgreSQL. Cancellation is routed back
 * into the same executor via `cancelImport`. `getDb`: the SQLite database of
 * the session; leave it out for a PostgreSQL session.
 */
export async function startImport(
  filePath: string,
  caseName: string,
  vcfOptions: VcfImportOptions | undefined,
  getSession: () => StorageSession,
  callbacks: ImportCallbacks,
  getDb?: () => DatabaseService
): Promise<ImportResult> {
  const session = getSession()
  const executor = session.getImportExecutor()
  // SQLite (`getDb` given): when the worker stops keeping the cohort summary
  // current, the renderer hears it at once, and again when it is current.
  const stale = createCohortStaleAnnouncer(callbacks.onCohortStale)
  return withActiveImportOperation(
    () => executor.cancel(),
    async () => {
      try {
        return await executor.importSingleFile({
          filePath,
          caseName,
          vcfOptions,
          throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
          onProgress: callbacks.onProgress,
          onSummaryStale: () => stale.announce()
        })
      } finally {
        if (getDb !== undefined)
          await settleAfterWorkerImport(getDb, callbacks.onCohortStale, stale)
      }
    }
  )
}

/**
 * Cancel the active import operation.
 */
export function cancelImport(): void {
  activeImportOperation?.cancel()
}

/**
 * Per-file specification for a multi-file import session.
 *
 * `variantType` is the user-confirmed type from the wizard (snv/sv/cnv/str),
 * `caller` is the detected variant caller (manta, delly, etc.) or null,
 * `annotationFormat` is the annotation style (csq/ann) or null.
 */
export interface MultiFileImportSpec {
  filePath: string
  variantType: string
  caller: string | null
  annotationFormat: string | null
}

/**
 * Per-file result within a multi-file import session.
 * `error` is populated when that file failed but the overall session continued.
 */
export interface MultiFileImportFileResult {
  filePath: string
  variantType: string
  variantCount: number
  error?: string
}

/**
 * Aggregate result of a multi-file import session.
 */
export interface MultiFileImportResult extends ImportDataReport {
  caseId: number
  totalVariants: number
  totalSkipped: number
  files: MultiFileImportFileResult[]
  elapsed: number
}

/**
 * SQLite-specific implementation of multi-file import.
 *
 * The first file is imported via the executor's worker, which creates the
 * case. The remaining files are appended by the import worker in one session
 * (appendFilesInWorker): each file is one transaction with its variant_count,
 * and the worker rebuilds FTS (bulk session) and the cohort summary itself.
 *
 * A case-level genome-build lock is enforced: every subsequent file must
 * match the build detected from the first file's header (or match the
 * wizard-selected build). A mismatching file is refused before any of its
 * rows are inserted.
 *
 * Do NOT call this directly — use `startMultiFileImport` which dispatches
 * to this function for SQLite sessions and to the executor for PostgreSQL.
 */
async function startMultiFileImportSqlite(
  caseName: string,
  files: MultiFileImportSpec[],
  vcfOptions: VcfImportOptions | undefined,
  getSession: () => StorageSession,
  getDb: () => DatabaseService,
  callbacks: ImportCallbacks,
  signal?: AbortSignal,
  filtersPayload?: ImportFiltersPayload
): Promise<MultiFileImportResult> {
  const startTime = Date.now()
  const isCancelled = (): boolean => signal?.aborted === true

  if (files.length === 0) {
    throw new Error('No files provided for import')
  }

  const db = getDb()
  const { appendFilesInWorker, detectGenomeBuildFromFile } = await import('./import-logic-append')

  const totalFiles = files.length

  /**
   * Wrap the caller-supplied `onProgress` callback so every event the
   * underlying importer (worker or append loop) emits is augmented with
   * the current file's index + path. The renderer previously had to
   * infer transitions from "count reset" heuristics — brittle, and it
   * misattributed variant counts across files in some orderings.
   */
  function wrapCallbacksForFile(spec: MultiFileImportSpec, fileIndex: number): ImportCallbacks {
    return {
      onProgress: (data) => {
        callbacks.onProgress?.({
          ...data,
          fileIndex,
          totalFiles,
          filePath: spec.filePath,
          fileName: spec.filePath.split(/[\\/]/).pop() ?? spec.filePath
        })
      }
    }
  }

  // Import first file — creates the case
  const firstFile = files[0]
  const firstCallbacks = wrapCallbacksForFile(firstFile, 0)
  const stale = createCohortStaleAnnouncer(callbacks.onCohortStale)
  const executor = getSession().getImportExecutor()
  const firstResult = await executor
    .importSingleFile({
      filePath: firstFile.filePath,
      caseName,
      vcfOptions,
      // The worker loads the BED file itself, so it gets the path (#484).
      filters: filtersPayload && translateFiltersPayloadToStorage(filtersPayload),
      throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
      onProgress: firstCallbacks.onProgress,
      onSummaryStale: () => stale.announce()
    })
    .catch(async (error: unknown) => {
      await settleAfterWorkerImport(getDb, callbacks.onCohortStale, stale)
      throw error
    })

  if (firstResult.caseId === 0) {
    await settleAfterWorkerImport(getDb, callbacks.onCohortStale, stale)
    throw new Error(
      `Failed to create case from first file: ${
        firstResult.errors.length > 0 ? firstResult.errors.join(', ') : 'unknown error'
      }`
    )
  }

  const caseId = firstResult.caseId
  const fileResults: MultiFileImportFileResult[] = []

  recordImportFile(db, caseId, firstFile, firstResult.variantCount)

  fileResults.push({
    filePath: firstFile.filePath,
    variantType: firstFile.variantType,
    variantCount: firstResult.variantCount
  })

  let totalVariants = firstResult.variantCount
  const unrankedLists: Array<string[] | undefined> = [firstResult.unrankedClinvar]
  let afOutOfRange = firstResult.afOutOfRange ?? 0
  let totalSkipped = firstResult.skipped

  // The files of one case are checked against each other: the first file's own
  // header build, else the user's choice, else the case row (the build the
  // worker resolved, never a default). A user who overrides the build the
  // headers declare does not get the other files rejected.
  let lockedGenomeBuild: string | null =
    (files.length > 1
      ? await detectGenomeBuildFromFile(firstFile.filePath).catch(() => null)
      : null) ??
    vcfOptions?.genomeBuild ??
    null
  if (lockedGenomeBuild === null) {
    try {
      const caseRow = db.cases.getCase(caseId)
      lockedGenomeBuild = caseRow.genome_build ?? null
    } catch {
      lockedGenomeBuild = null
    }
  }

  // Files 2..N: each is checked against the case's build here (a header
  // read), then the import worker appends them in one session (#551).
  const appended: Array<{ spec: MultiFileImportSpec; index: number }> = []
  const outcomes = new Map<number, MultiFileImportFileResult>()
  for (let i = 1; i < files.length && !isCancelled(); i++) {
    const spec = files[i]
    try {
      assertGenomeBuildMatches(
        lockedGenomeBuild,
        await detectGenomeBuildFromFile(spec.filePath),
        spec.filePath
      )
      appended.push({ spec, index: i })
    } catch (error) {
      outcomes.set(i, appendFailure(spec, error))
    }
  }

  if (appended.length > 0 && !isCancelled()) {
    try {
      const results = await appendFilesInWorker({
        db,
        caseId,
        filePaths: appended.map((a) => a.spec.filePath),
        vcfOptions,
        filters: filtersPayload && translateFiltersPayloadToStorage(filtersPayload),
        onProgress: (n, count, skipped) => {
          const { spec, index } = appended[n]
          wrapCallbacksForFile(spec, index).onProgress?.({
            phase: 'inserting',
            count,
            elapsed: Date.now() - startTime,
            skipped
          })
        },
        onSummaryStale: () => stale.announce(),
        signal,
        createWorkerClient:
          executor instanceof SqliteImportExecutor ? executor.createWorkerClient : undefined
      })
      results.forEach((result, n) => {
        const { spec, index } = appended[n]
        if (result.error !== undefined) {
          outcomes.set(index, appendFailure(spec, result.error))
          return
        }
        recordImportFile(db, caseId, spec, result.variantCount)
        totalVariants += result.variantCount
        totalSkipped += result.skipped
        unrankedLists.push(result.unrankedClinvar)
        afOutOfRange += result.afOutOfRange ?? 0
        outcomes.set(index, {
          filePath: spec.filePath,
          variantType: spec.variantType,
          variantCount: result.variantCount
        })
      })
    } catch (error) {
      for (const { spec, index } of appended) {
        if (!outcomes.has(index)) outcomes.set(index, appendFailure(spec, error))
      }
    }
  }
  for (let i = 1; i < files.length; i++) {
    const outcome = outcomes.get(i)
    if (outcome !== undefined) fileResults.push(outcome)
  }

  // The worker rebuilt the summary it flagged stale with the appends; repair
  // it here only if that failed, and tell the renderer it is current.
  await settleAfterWorkerImport(getDb, callbacks.onCohortStale, stale)

  const unrankedClinvar = mergeUnrankedClinvar(unrankedLists)
  return {
    caseId,
    totalVariants,
    totalSkipped,
    files: fileResults,
    elapsed: Date.now() - startTime,
    ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {}),
    ...(afOutOfRange > 0 ? { afOutOfRange } : {})
  }
}

/** A file of a multi-file case that was not appended, logged. */
function appendFailure(spec: MultiFileImportSpec, error: unknown): MultiFileImportFileResult {
  const message = error instanceof Error ? error.message : String(error)
  mainLogger.error(`Failed to import file ${spec.filePath}: ${message}`, 'import')
  return { filePath: spec.filePath, variantType: spec.variantType, variantCount: 0, error: message }
}

/** Per-file provenance of a multi-file case (best effort). */
function recordImportFile(
  db: DatabaseService,
  caseId: number,
  spec: MultiFileImportSpec,
  variantCount: number
): void {
  try {
    db.cases.insertImportFile({
      case_id: caseId,
      file_path: spec.filePath,
      file_size: statSync(spec.filePath).size,
      variant_type: spec.variantType,
      caller: spec.caller,
      variant_count: variantCount,
      annotation_format: spec.annotationFormat
    })
  } catch (e) {
    mainLogger.warn(
      `Failed to record import file provenance for ${spec.filePath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      'import'
    )
  }
}

/**
 * Backend-aware entry point for multi-file import; the IPC handler and the web
 * route call this, never `startMultiFileImportSqlite`.
 *
 * - PostgreSQL: `session.getImportExecutor().importMultiFile()`. The worker
 *   loads the BED file itself, so it gets `filtersPayload` with the path.
 * - SQLite: `startMultiFileImportSqlite`; its import worker loads the BED
 *   file from `filtersPayload` too.
 *
 * Every file is read for one sample: the selected one, else file 1's first
 * (a single-sample file appended to the case is read as that sample).
 */
export async function startMultiFileImport(
  caseName: string,
  files: MultiFileImportSpec[],
  vcfOptions: VcfImportOptions | undefined,
  getSession: () => StorageSession,
  getDb: () => DatabaseService,
  callbacks: ImportCallbacks,
  filtersPayload?: ImportFiltersPayload
): Promise<MultiFileImportResult> {
  const session = getSession()
  const executor = session.getImportExecutor()
  const controller = new AbortController()

  return withActiveImportOperation(
    () => {
      controller.abort()
      executor.cancel()
    },
    async () => {
      const selectedSample = await resolveCaseSample(files[0]?.filePath, vcfOptions?.selectedSample)
      if (selectedSample !== undefined) vcfOptions = { ...vcfOptions, selectedSample }
      if (session.capabilities.backend === 'postgres') {
        const storageFilters =
          filtersPayload !== undefined
            ? translateFiltersPayloadToStorage(filtersPayload)
            : undefined
        const result = await executor.importMultiFile({
          caseName,
          files,
          vcfOptions,
          filters: storageFilters,
          onProgress: callbacks.onProgress
        })
        return {
          caseId: result.caseId,
          totalVariants: result.variantCount,
          totalSkipped: result.skipped,
          files: result.files,
          elapsed: result.elapsed,
          ...importDataReport(result)
        }
      }

      return startMultiFileImportSqlite(
        caseName,
        files,
        vcfOptions,
        getSession,
        getDb,
        callbacks,
        controller.signal,
        filtersPayload
      )
    }
  )
}

/**
 * Get a VCF file preview (samples, header info, etc.).
 */
export async function getVcfPreview(filePath: string): Promise<unknown> {
  const { getVcfPreview: vcfPreview } = await import('../../import/vcf/vcf-preview')
  return vcfPreview(filePath)
}

/**
 * Get VCF preview for multiple files at once, plus sibling BED files
 * and a suggested case name. Used by the multi-file import wizard.
 */
export async function getVcfMultiPreview(filePaths: string[]): Promise<unknown> {
  const { getVcfMultiPreview: multiPreview } = await import('../../import/vcf/vcf-preview')
  return multiPreview(filePaths)
}
