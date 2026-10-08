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
import { mainLogger } from '../../services/MainLogger'
import { mergeUnrankedClinvar } from '../../import/unranked-clinvar'
import { ConflictError } from '../errors'
import { API_CONFIG } from '../../../shared/config/api.config'
import type { DatabaseService } from '../../database/DatabaseService'
import { VariantFrequencyService } from '../../database/VariantFrequencyService'
import {
  createCohortStaleAnnouncer,
  markCohortSummaryStaleBeforeAppend,
  rebuildCohortSummaryAfterAppend,
  settleAfterWorkerImport,
  type EmitCohortStale
} from './cohort-summary-settle'
import type { ImportFilters } from '../../import/vcf/import-filters'
import { assertGenomeBuildMatches, resolveCaseSample } from '../../import/vcf/vcf-header-parser'
import type { StorageImportFileFilters } from '../../storage/import-executor'
import type { StorageSession } from '../../storage/session'

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
export interface ImportResult {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[]
  elapsed: number
  /** ClinVar values of this import that the severity configuration does not know. */
  unrankedClinvar?: string[]
}

/** Options for VCF import. */
export interface VcfImportOptions {
  selectedSample?: string
  genomeBuild?: string
}

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
export interface MultiFileImportResult {
  caseId: number
  totalVariants: number
  totalSkipped: number
  files: MultiFileImportFileResult[]
  elapsed: number
  /** ClinVar values of all files that the severity configuration does not know. */
  unrankedClinvar?: string[]
}

/**
 * SQLite-specific implementation of multi-file import.
 *
 * The first file is imported via startImport (which creates the case via
 * the worker with its own bulk-insert session). Remaining files are appended
 * on the main thread via importAdditionalFileToCase.
 *
 * End-of-session housekeeping (executed once after all files):
 *   1. Rebuild FTS index + restore FTS triggers (single pass across all appends)
 *   2. Recompute case variant_count from the variants table atomically
 *   3. Update variant_frequency table
 *   4. Rebuild the cohort summary (only when files were appended: the worker
 *      keeps it exact for the first file, the appends are not merged into it)
 *
 * A case-level genome-build lock is enforced: every subsequent file must
 * match the build detected from the first file's header (or match the
 * wizard-selected build). Mismatches abort the whole session before any
 * inserts for the offending file are performed.
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
  importFilters?: ImportFilters,
  signal?: AbortSignal,
  filtersPayload?: ImportFiltersPayload
): Promise<MultiFileImportResult> {
  const startTime = Date.now()
  const isCancelled = (): boolean => signal?.aborted === true

  if (files.length === 0) {
    throw new Error('No files provided for import')
  }

  const db = getDb()
  const { statSync } = await import('node:fs')
  const { importAdditionalFileToCase, detectGenomeBuildFromFile } =
    await import('./import-logic-append')

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
  const firstResult = await getSession()
    .getImportExecutor()
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

  // Record first file provenance
  try {
    const firstFileSize = statSync(firstFile.filePath).size
    db.cases.insertImportFile({
      case_id: caseId,
      file_path: firstFile.filePath,
      file_size: firstFileSize,
      variant_type: firstFile.variantType,
      caller: firstFile.caller,
      variant_count: firstResult.variantCount,
      annotation_format: firstFile.annotationFormat
    })
  } catch (e) {
    mainLogger.warn(
      `Failed to record import file provenance for ${firstFile.filePath}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      'import'
    )
  }

  fileResults.push({
    filePath: firstFile.filePath,
    variantType: firstFile.variantType,
    variantCount: firstResult.variantCount
  })

  let totalVariants = firstResult.variantCount
  const unrankedLists: Array<string[] | undefined> = [firstResult.unrankedClinvar]
  let totalSkipped = firstResult.skipped

  // Resolve the case-level locked genome build. Prefer the wizard-supplied
  // value; otherwise read it back from the case row populated by the worker.
  let lockedGenomeBuild: string | null = vcfOptions?.genomeBuild ?? null
  if (lockedGenomeBuild === null) {
    try {
      const caseRow = db.cases.getCase(caseId)
      lockedGenomeBuild = caseRow.genome_build ?? null
    } catch {
      lockedGenomeBuild = null
    }
  }

  // The worker counted the case once per coordinate of the first file. Record
  // the case's last variant id so the end-of-session upkeep can count only
  // coordinates the appended files add (see updateFrequenciesForAppend).
  const frequencies = files.length > 1 ? new VariantFrequencyService(db.database) : null
  const frequencyWatermark = frequencies?.caseVariantWatermark(caseId) ?? 0

  // Wrap all main-thread appends in a single bulk-insert session so FTS
  // triggers are only torn down and rebuilt ONCE across all appended files.
  // Without this bracket, the FTS `ai` trigger fires per row and the append
  // loop becomes O(n²) for large files (e.g. a Sniffles2 300k-SV VCF).
  if (files.length > 1) {
    // Before the first appended row, not after the last (see the function).
    markCohortSummaryStaleBeforeAppend(db)
    db.variants.beginBulkInsert()
  }
  try {
    // Append remaining files into the same case
    for (let i = 1; i < files.length; i++) {
      if (isCancelled()) break
      const spec = files[i]
      try {
        // ── Genome build lock enforcement ───────────────────────────
        // Parse the header of the appended file and compare its detected
        // build against the case's locked build. Mismatches abort the
        // import of this file BEFORE any variants are inserted.
        const fileBuild = await detectGenomeBuildFromFile(spec.filePath)
        assertGenomeBuildMatches(lockedGenomeBuild, fileBuild, spec.filePath)

        const fileSize = statSync(spec.filePath).size

        const result = await importAdditionalFileToCase(
          caseId,
          spec.filePath,
          vcfOptions,
          getDb,
          wrapCallbacksForFile(spec, i),
          importFilters,
          signal
        )

        db.cases.insertImportFile({
          case_id: caseId,
          file_path: spec.filePath,
          file_size: fileSize,
          variant_type: spec.variantType,
          caller: spec.caller,
          variant_count: result.variantCount,
          annotation_format: spec.annotationFormat
        })

        totalVariants += result.variantCount
        totalSkipped += result.skipped
        unrankedLists.push(result.unrankedClinvar)

        fileResults.push({
          filePath: spec.filePath,
          variantType: spec.variantType,
          variantCount: result.variantCount
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        mainLogger.error(`Failed to import file ${spec.filePath}: ${message}`, 'import')
        fileResults.push({
          filePath: spec.filePath,
          variantType: spec.variantType,
          variantCount: 0,
          error: message
        })
        if (isCancelled()) break
      }
    }
  } finally {
    if (files.length > 1) {
      // Rebuild FTS + restore triggers + ANALYZE + optimize, regardless of
      // how the append loop exited (success, per-file error, or thrown).
      try {
        db.variants.finishBulkInsertNoCount()
      } catch (e) {
        mainLogger.error(
          `Failed to finalize bulk insert after multi-file append: ${
            e instanceof Error ? e.message : String(e)
          }`,
          'import'
        )
      }
    }
  }

  // ── End-of-session housekeeping ────────────────────────────────
  // Order matters: refresh variant_count first (it's the authoritative total
  // of the variants table for this case), then update cross-case frequency
  // counts, then bring the cohort summary up to date. We do this ONCE per
  // session, not per file.
  try {
    db.variants.recalculateCaseVariantCount(caseId)
  } catch (e) {
    mainLogger.warn(
      `Failed to recalculate variant_count for case ${caseId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
      'import'
    )
  }

  if (frequencies !== null) {
    // Incremental, not "decrement the merged case then re-add": the merged
    // case holds coordinates the worker never counted, and decrementing those
    // would steal a count from other cases that carry them.
    try {
      frequencies.updateFrequenciesForAppend(caseId, frequencyWatermark)
    } catch (e) {
      mainLogger.warn(
        `Failed to refresh variant frequencies after multi-file import: ${
          e instanceof Error ? e.message : String(e)
        }`,
        'import'
      )
    }
  }

  // The worker merged the first file into the cohort summary; the appended
  // files went in behind its back, so the summary is out of date for this
  // case (flagged stale since before the first append). Rebuild before the
  // import is reported done.
  if (files.length > 1) {
    await rebuildCohortSummaryAfterAppend(db, callbacks.onCohortStale)
  } else {
    // One file is a single-file import: only the worker touched the summary.
    await settleAfterWorkerImport(getDb, callbacks.onCohortStale, stale)
  }

  const unrankedClinvar = mergeUnrankedClinvar(unrankedLists)
  return {
    caseId,
    totalVariants,
    totalSkipped,
    files: fileResults,
    elapsed: Date.now() - startTime,
    ...(unrankedClinvar !== undefined ? { unrankedClinvar } : {})
  }
}

/**
 * Backend-aware entry point for multi-file import; the IPC handler and the web
 * route call this, never `startMultiFileImportSqlite`.
 *
 * - PostgreSQL: `session.getImportExecutor().importMultiFile()`. The worker
 *   loads the BED file itself, so it gets `filtersPayload` with the path.
 * - SQLite: `startMultiFileImportSqlite`, with the built `importFilters` for
 *   the appended files and `filtersPayload` for the worker's first file.
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
  importFilters?: ImportFilters,
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
          ...(result.unrankedClinvar !== undefined
            ? { unrankedClinvar: result.unrankedClinvar }
            : {})
        }
      }

      return startMultiFileImportSqlite(
        caseName,
        files,
        vcfOptions,
        getSession,
        getDb,
        callbacks,
        importFilters,
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
