/**
 * Pure business logic for batch-import IPC handlers.
 *
 * All functions take explicit dependencies (db, callbacks) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import { basename } from 'path'
import { randomUUID } from 'node:crypto'
import { mainLogger } from '../../services/MainLogger'
import { jobRunner } from '../../services/jobs/runner'
import { checkDuplicates } from '../../import/batch-utils'
import { ZipExtractor, TempDirectoryManager } from '../../import'
import { ImportWorkerClient } from '../../workers/import-worker-client'
import { API_CONFIG } from '../../../shared/config'
import type { FileImportRequest } from '../../../shared/types/import-worker'
import type { DatabaseService } from '../../database/DatabaseService'
import type { BatchProgress, DuplicateChoice } from '../../../shared/types/api'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'

/** Callbacks for emitting events to the renderer during batch import. */
export interface BatchImportCallbacks {
  onProgress?: (data: BatchProgress) => void
  onComplete?: (data: BatchImportResult) => void
  onCohortStale?: (data: { is_stale: boolean }) => void
}

// Track current batch import for cancellation
let workerClient: ImportWorkerClient | null = null

// ZIP extraction utilities
const zipExtractor = new ZipExtractor()
interface ActiveZipExtraction {
  manager: TempDirectoryManager
  enrolledPaths: string[]
  revokeEnrollment?: (filePath: string) => void
}
const zipExtractions = new Map<string, ActiveZipExtraction>()
const orphanedZipExtractions = new Set<string>()
const MAX_ACTIVE_ZIP_EXTRACTIONS = 4

/**
 * Check which files have duplicate case names in the database.
 */
export function checkDuplicateFiles(
  getDb: () => DatabaseService,
  filePaths: string[],
  stripText?: string
): {
  files: Array<{ filePath: string; fileName: string; caseName: string; isDuplicate: boolean }>
  duplicateCount: number
} {
  try {
    const db = getDb()
    const result = checkDuplicates(db, filePaths, stripText)

    return {
      files: result.files.map((f) => ({
        filePath: f.filePath,
        fileName: f.fileName,
        caseName: f.caseName,
        isDuplicate: f.isDuplicate
      })),
      duplicateCount: result.duplicateCount
    }
  } catch (error) {
    // A DB/lookup failure here is not the same as "no duplicates found" — let
    // it propagate so wrapHandler structures it and the caller sees an error
    // instead of a falsely-empty duplicate check.
    mainLogger.error(`checkDuplicates error: ${error}`, 'import')
    throw error
  }
}

/** Result payload returned by {@link startBatchImport}. */
export interface BatchImportResult {
  succeeded: number
  failed: number
  skipped: number
  cancelled: boolean
  details: Array<{
    filePath: string
    fileName: string
    status: string
    caseName?: string
    variantCount?: number
    error?: string
  }>
}

/** Params tracked on the `import_batch` job (see {@link JobRunner}). */
interface BatchImportParams {
  files: FileImportRequest[]
}

/**
 * Start batch import with a pre-determined duplicate strategy.
 * Delegates to import worker thread.
 *
 * The actual worker run is enqueued on the shared {@link jobRunner} under the
 * `import_batch` kind, which enforces single-flight (message "A batch import is
 * already in progress") and routes cancellation to {@link ImportWorkerClient.cancel}.
 * `callbacks.onCohortStale` and the per-file IPC emissions are unchanged.
 */
export async function startBatchImport(
  getDb: () => DatabaseService,
  filePaths: string[],
  duplicateStrategy: DuplicateChoice,
  stripText: string | undefined,
  callbacks: BatchImportCallbacks
): Promise<BatchImportResult> {
  try {
    const db = getDb()

    callbacks.onCohortStale?.({ is_stale: true })

    // Build FileImportRequest array with duplicate info
    const checkResult = checkDuplicates(db, filePaths, stripText)

    const files = checkResult.files.map((f) => ({
      filePath: f.filePath,
      caseName: f.caseName,
      isDuplicate: f.isDuplicate,
      duplicateStrategy
    }))

    const handle = jobRunner.enqueue<BatchImportParams, BatchImportResult>(
      'import_batch',
      { files },
      async (ctx, p) => {
        const client = new ImportWorkerClient()
        workerClient = client
        ctx.registerCancel(() => client.cancel())
        try {
          return await runBatchWorker(db, p.files, callbacks, client)
        } finally {
          if (workerClient === client) workerClient = null
        }
      }
    )
    return await handle.result
  } catch (error) {
    mainLogger.error(`batch-import:start error: ${error}`, 'import')
    return {
      succeeded: 0,
      failed: filePaths.length,
      skipped: 0,
      cancelled: false,
      details: filePaths.map((fp) => ({
        filePath: fp,
        fileName: basename(fp) || 'unknown',
        status: 'failed' as const,
        error: formatBatchImportError(error)
      }))
    }
  }
}

function formatBatchImportError(error: unknown): string {
  return formatErrorMessage(error, 'Unknown error')
}

/**
 * Run the import worker for a prepared batch and resolve to the aggregated
 * result. The progress / completion / cohort-stale emissions are identical to
 * the pre-JobRunner path; only the single-flight gate and cancellation hook
 * moved up into {@link startBatchImport}.
 */
function runBatchWorker(
  db: DatabaseService,
  files: FileImportRequest[],
  callbacks: BatchImportCallbacks,
  client: ImportWorkerClient
): Promise<BatchImportResult> {
  return new Promise((resolve, reject) => {
    client.start({
      files,
      dbPath: db.getPath(),
      encryptionKey: db.getEncryptionKey(),
      throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
      onProgress: (msg) => {
        const progress: BatchProgress = {
          currentIndex: msg.fileIndex,
          totalFiles: msg.totalFiles,
          currentFileName: msg.fileName,
          overallPercent: msg.overallPercent,
          fileProgress: {
            phase: msg.phase,
            count: msg.variantCount,
            elapsed: 0,
            skipped: msg.skipped
          }
        }
        callbacks.onProgress?.(progress)
      },
      onFileComplete: () => {
        // File complete -- progress already sent via onProgress
      },
      onComplete: (msg) => {
        // Update internal variant frequency counts for successful imports
        try {
          for (const detail of msg.results.details) {
            if (detail.status === 'success' && detail.caseName) {
              const c = db.cases.getCaseByName(detail.caseName)
              db.variants.updateFrequencies(c.id)
            }
          }
        } catch (freqError) {
          mainLogger.warn(`Failed to update variant frequencies: ${freqError}`, 'batch-import')
        }

        // Send final progress
        callbacks.onProgress?.({
          currentIndex: msg.results.details.length,
          totalFiles: msg.results.details.length,
          currentFileName: '',
          overallPercent: 100
        })

        callbacks.onCohortStale?.({ is_stale: false })

        // Build a plain-data result object. Use JSON round-trip to
        // guarantee structured-clone compatibility.
        const batchResult = JSON.parse(
          JSON.stringify({
            succeeded: msg.results.succeeded,
            failed: msg.results.failed,
            skipped: msg.results.skipped,
            cancelled: msg.results.cancelled,
            details: msg.results.details.map((d) => ({
              filePath: d.filePath,
              fileName: d.fileName,
              status: d.status,
              caseName: d.caseName,
              variantCount: d.variantCount,
              error: d.error
            }))
          })
        )

        // Notify renderer globally that import completed
        callbacks.onComplete?.(batchResult)

        resolve(batchResult)
      },
      onError: (msg) => {
        if (msg.fileIndex === -1) {
          // Fatal error
          reject(new Error(msg.error))
        }
      }
    })
  })
}

/**
 * Cancel the current batch import.
 */
export function cancelBatchImport(): void {
  if (workerClient !== null) {
    workerClient.cancel()
  }
}

/**
 * Test a ZIP file password.
 *
 * `ZipExtractor.testPassword` already distinguishes a genuine wrong-password
 * outcome (returns `false`) from an unopenable/corrupt archive (throws). Do
 * not re-collapse that distinction here: a corrupt archive must propagate as
 * an error, not be reported as "incorrect password".
 */
export function testZipPassword(zipPath: string, password: string): { success: boolean } {
  try {
    const success = zipExtractor.testPassword(zipPath, password)
    return { success }
  } catch (error) {
    mainLogger.error(`batch-import:testZipPassword error: ${error}`, 'import')
    throw error
  }
}

/**
 * Extract files from a ZIP archive.
 */
export async function extractZip(
  zipPath: string,
  password?: string,
  onExtractedFile?: (filePath: string) => void,
  onRemoveExtractedFile?: (filePath: string) => void
): Promise<{ files: string[]; errors: string[]; extractionId: string }> {
  const manager = new TempDirectoryManager()
  const extractionId = randomUUID()
  try {
    retryOrphanedZipCleanups()
    if (zipExtractions.size >= MAX_ACTIVE_ZIP_EXTRACTIONS) {
      throw new Error('Too many active ZIP extractions; clean up an existing extraction first')
    }
    const targetDir = manager.create()
    const extraction: ActiveZipExtraction = { manager, enrolledPaths: [] }
    zipExtractions.set(extractionId, extraction)

    const result = await zipExtractor.extract(zipPath, targetDir, password)

    // Partial extraction is not a safe success state: the renderer cannot
    // know whether a missing case is optional, corrupt, or failed to write.
    // Fail the whole archive on any candidate error; the catch below removes
    // the temporary directory so already-written files cannot be imported.
    if (result.errors.length > 0) {
      throw new Error(
        `ZIP extraction failed for ${result.errors.length} candidate ` +
          `entr${result.errors.length === 1 ? 'y' : 'ies'}: ${result.errors.join('; ')}`
      )
    }

    if (onExtractedFile !== undefined) {
      extraction.revokeEnrollment = onRemoveExtractedFile
      for (const extractedFile of result.extractedFiles) {
        extraction.enrolledPaths.push(extractedFile)
        onExtractedFile(extractedFile)
      }
    }

    return JSON.parse(
      JSON.stringify({
        files: result.extractedFiles,
        errors: result.errors,
        extractionId
      })
    )
  } catch (error) {
    // A genuinely empty/all-benign extraction is reported by ZipExtractor.extract
    // as a normal resolved result ({ extractedFiles: [], errors: [] }) — it
    // never reaches this catch. Anything that lands here (unreadable/corrupt
    // archive, fs failure, or the all-entries-failed case thrown above) is an
    // infrastructure fault and must not be reshaped into a fake-success
    // zero-file result.
    mainLogger.error(`batch-import:extractZip error: ${error}`, 'import')
    try {
      cleanupZipTemp(extractionId)
    } catch (cleanupError) {
      orphanedZipExtractions.add(extractionId)
      const cleanupMessage = formatErrorMessage(cleanupError, 'cleanup failed')
      throw new Error(
        `${formatErrorMessage(error, 'ZIP extraction failed')}; temporary-file cleanup also failed: ${cleanupMessage}`,
        { cause: cleanupError }
      )
    }
    throw error
  }
}

/**
 * Clean up temporary ZIP extraction directory.
 */
export function cleanupZipTemp(extractionId: string): void {
  const extraction = zipExtractions.get(extractionId)
  if (extraction === undefined) return

  revokeExtractedPaths(extraction)
  try {
    extraction.manager.cleanup()
  } catch (error) {
    orphanedZipExtractions.add(extractionId)
    throw error
  }
  zipExtractions.delete(extractionId)
  orphanedZipExtractions.delete(extractionId)
}

function retryOrphanedZipCleanups(): void {
  for (const extractionId of [...orphanedZipExtractions]) {
    cleanupZipTemp(extractionId)
  }
}

function revokeExtractedPaths(extraction: ActiveZipExtraction): void {
  if (extraction.revokeEnrollment !== undefined) {
    for (const filePath of extraction.enrolledPaths) {
      extraction.revokeEnrollment(filePath)
    }
  }
  extraction.enrolledPaths = []
  extraction.revokeEnrollment = undefined
}
