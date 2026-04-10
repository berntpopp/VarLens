/**
 * Pure business logic for import IPC handlers.
 *
 * All functions take explicit dependencies (db, callbacks) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import { ImportWorkerClient } from '../../workers/import-worker-client'
import { mainLogger } from '../../services/MainLogger'
import { API_CONFIG } from '../../../shared/config/api.config'
import type { DatabaseService } from '../../database/DatabaseService'
import type { ImportFilters } from '../../import/vcf/import-filters'

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
}

/** Result of a successful import. */
export interface ImportResult {
  caseId: number
  variantCount: number
  skipped: number
  errors: string[]
  elapsed: number
}

/** Options for VCF import. */
export interface VcfImportOptions {
  selectedSample?: string
  genomeBuild?: string
}

// Keep a reference to the active worker for cancellation
let workerClient: ImportWorkerClient | null = null

/**
 * Start an import operation using a worker thread.
 * Returns a promise that resolves with the import result.
 */
export function startImport(
  filePath: string,
  caseName: string,
  vcfOptions: VcfImportOptions | undefined,
  getDb: () => DatabaseService,
  callbacks: ImportCallbacks
): Promise<ImportResult> {
  const db = getDb()

  if (workerClient?.isRunning === true) {
    throw new Error('An import is already in progress')
  }

  workerClient = new ImportWorkerClient()

  return new Promise((resolve, reject) => {
    let capturedCaseId = 0

    workerClient!.start({
      files: [
        {
          filePath,
          caseName,
          isDuplicate: false,
          duplicateStrategy: 'skip',
          vcfSelectedSamples:
            vcfOptions?.selectedSample != null && vcfOptions.selectedSample !== ''
              ? [vcfOptions.selectedSample]
              : undefined,
          vcfGenomeBuild: vcfOptions?.genomeBuild
        }
      ],
      dbPath: db.getPath(),
      encryptionKey: db.getEncryptionKey(),
      throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
      onProgress: (msg) => {
        callbacks.onProgress?.({
          phase: msg.phase === 'finalizing' ? 'inserting' : msg.phase,
          count: msg.variantCount,
          elapsed: 0,
          skipped: msg.skipped
        })
      },
      onFileComplete: (msg) => {
        capturedCaseId = msg.result.caseId
      },
      onComplete: (msg) => {
        workerClient = null
        if (msg.results.cancelled === true) {
          resolve({
            caseId: 0,
            variantCount: 0,
            skipped: 0,
            errors: ['Import cancelled by user'],
            elapsed: 0
          })
          return
        }
        const detail = msg.results.details[0]
        if (detail !== undefined && detail.status === 'success') {
          callbacks.onProgress?.({
            phase: 'inserting',
            count: detail.variantCount ?? 0,
            elapsed: 0,
            skipped: 0
          })
          // Update internal variant frequency counts
          try {
            db.variants.updateFrequencies(capturedCaseId)
          } catch (freqError) {
            mainLogger.warn(`Failed to update variant frequencies: ${freqError}`, 'import')
          }
          resolve({
            caseId: capturedCaseId,
            variantCount: detail.variantCount ?? 0,
            skipped: 0,
            errors: [],
            elapsed: 0
          })
        } else {
          reject(new Error(detail?.error ?? 'Import failed'))
        }
      },
      onError: (msg) => {
        if (msg.fileIndex === -1) {
          workerClient = null
          reject(new Error(msg.error))
        }
      }
    })
  })
}

/**
 * Cancel the active import operation.
 */
export function cancelImport(): void {
  if (workerClient !== null) {
    workerClient.cancel()
  }
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
}

/**
 * Import multiple VCF files into a single case sequentially.
 *
 * The first file is imported via startImport (which creates the case via
 * the worker with its own bulk-insert session). Remaining files are appended
 * on the main thread via importAdditionalFileToCase.
 *
 * End-of-session housekeeping (executed once after all files):
 *   1. Rebuild FTS index + restore FTS triggers (single pass across all appends)
 *   2. Recompute case variant_count from the variants table atomically
 *   3. Update variant_frequency table
 *   4. Mark cohort_variant_summary as stale (UI/rebuild-worker triggers recompute)
 *
 * A case-level genome-build lock is enforced: every subsequent file must
 * match the build detected from the first file's header (or match the
 * wizard-selected build). Mismatches abort the whole session before any
 * inserts for the offending file are performed.
 */
export async function startMultiFileImport(
  caseName: string,
  files: MultiFileImportSpec[],
  vcfOptions: VcfImportOptions | undefined,
  getDb: () => DatabaseService,
  callbacks: ImportCallbacks,
  importFilters?: ImportFilters
): Promise<MultiFileImportResult> {
  const startTime = Date.now()

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
  const firstResult = await startImport(
    firstFile.filePath,
    caseName,
    vcfOptions,
    getDb,
    wrapCallbacksForFile(firstFile, 0)
  )

  if (firstResult.caseId === 0) {
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

  // Wrap all main-thread appends in a single bulk-insert session so FTS
  // triggers are only torn down and rebuilt ONCE across all appended files.
  // Without this bracket, the FTS `ai` trigger fires per row and the append
  // loop becomes O(n²) for large files (e.g. a Sniffles2 300k-SV VCF).
  if (files.length > 1) {
    db.variants.beginBulkInsert()
  }
  try {
    // Append remaining files into the same case
    for (let i = 1; i < files.length; i++) {
      const spec = files[i]
      try {
        // ── Genome build lock enforcement ───────────────────────────
        // Parse the header of the appended file and compare its detected
        // build against the case's locked build. Mismatches abort the
        // import of this file BEFORE any variants are inserted.
        const fileBuild = await detectGenomeBuildFromFile(spec.filePath)
        if (lockedGenomeBuild !== null && fileBuild !== null && fileBuild !== lockedGenomeBuild) {
          throw new Error(
            `Genome build mismatch: case is locked to ${lockedGenomeBuild} but ` +
              `${spec.filePath} declares ${fileBuild}. All files in a multi-file ` +
              `import must share the same reference assembly.`
          )
        }

        const fileSize = statSync(spec.filePath).size

        const result = await importAdditionalFileToCase(
          caseId,
          spec.filePath,
          vcfOptions,
          getDb,
          wrapCallbacksForFile(spec, i),
          importFilters
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
  // counts, then mark the cohort summary stale so the next cohort access
  // triggers a rebuild. We do this ONCE per session, not per file.
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

  if (files.length > 1) {
    // The worker already called updateFrequencies for the first file, so we
    // only need to do it again if we actually appended something. The update
    // is idempotent-on-insert because it uses ON CONFLICT DO UPDATE, but it
    // would double-count the first file's variants if called twice — so we
    // must decrement first and re-update.
    //
    // Simpler and robust: decrement the first file's contribution, then run
    // updateFrequencies once for the full (sum) case. Since updateFrequencies
    // uses DISTINCT, it deduplicates across appends.
    try {
      db.variants.decrementFrequencies(caseId)
      db.variants.updateFrequencies(caseId)
    } catch (e) {
      mainLogger.warn(
        `Failed to refresh variant frequencies after multi-file import: ${
          e instanceof Error ? e.message : String(e)
        }`,
        'import'
      )
    }
  }

  // Mark cohort summary stale so the next cohort access recomputes it.
  // Triggered only when we actually appended files — the first-file worker
  // already handles staleness for single-file imports.
  if (files.length > 1) {
    try {
      db.cohortSummary.markStale()
    } catch (e) {
      mainLogger.warn(
        `Failed to mark cohort summary stale: ${e instanceof Error ? e.message : String(e)}`,
        'import'
      )
    }
  }

  return {
    caseId,
    totalVariants,
    totalSkipped,
    files: fileResults,
    elapsed: Date.now() - startTime
  }
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
