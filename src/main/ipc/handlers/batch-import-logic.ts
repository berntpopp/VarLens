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
import type { DuplicateChoice } from '../../../shared/types/api'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'

/** Callbacks for emitting events to the renderer during batch import. */
export interface BatchImportCallbacks {
  onProgress?: (data: unknown) => void
  onComplete?: (data: unknown) => void
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
    mainLogger.error(`checkDuplicates error: ${error}`, 'import')
    return { files: [], duplicateCount: 0 }
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
        ctx.registerCancel(() => workerClient?.cancel())
        return await runBatchWorker(db, p.files, callbacks)
      }
    )
    return await handle.result
  } catch (error) {
    workerClient = null
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
  callbacks: BatchImportCallbacks
): Promise<BatchImportResult> {
  workerClient = new ImportWorkerClient()

  return new Promise((resolve, reject) => {
    workerClient!.start({
      files,
      dbPath: db.getPath(),
      encryptionKey: db.getEncryptionKey(),
      throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
      onProgress: (msg) => {
        callbacks.onProgress?.({
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
        })
      },
      onFileComplete: () => {
        // File complete -- progress already sent via onProgress
      },
      onComplete: (msg) => {
        workerClient = null

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
          workerClient = null
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
 */
export function testZipPassword(zipPath: string, password: string): { success: boolean } {
  try {
    const success = zipExtractor.testPassword(zipPath, password)
    return { success }
  } catch (error) {
    mainLogger.error(`batch-import:testZipPassword error: ${error}`, 'import')
    return { success: false }
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
    if (zipExtractions.size >= MAX_ACTIVE_ZIP_EXTRACTIONS) {
      throw new Error('Too many active ZIP extractions; clean up an existing extraction first')
    }
    const targetDir = manager.create()
    const extraction: ActiveZipExtraction = { manager, enrolledPaths: [] }
    zipExtractions.set(extractionId, extraction)

    const result = await zipExtractor.extract(zipPath, targetDir, password)

    if (onExtractedFile !== undefined) {
      for (const extractedFile of result.extractedFiles) {
        onExtractedFile(extractedFile)
      }
      extraction.enrolledPaths = [...result.extractedFiles]
      extraction.revokeEnrollment = onRemoveExtractedFile
    }

    return JSON.parse(
      JSON.stringify({
        files: result.extractedFiles,
        errors: result.errors,
        extractionId
      })
    )
  } catch (error) {
    mainLogger.error(`batch-import:extractZip error: ${error}`, 'import')
    const extraction = zipExtractions.get(extractionId)
    if (extraction !== undefined) {
      revokeExtractedPaths(extraction)
      try {
        extraction.manager.cleanup()
        zipExtractions.delete(extractionId)
      } catch (cleanupError) {
        mainLogger.error(`batch-import:cleanupZipTemp error: ${cleanupError}`, 'import')
      }
    } else {
      try {
        manager.cleanup()
      } catch (cleanupError) {
        mainLogger.error(`batch-import:cleanupZipTemp error: ${cleanupError}`, 'import')
      }
    }
    return {
      files: [],
      errors: [error instanceof Error ? error.message : 'Extraction failed'],
      extractionId
    }
  }
}

/**
 * Clean up temporary ZIP extraction directory.
 */
export function cleanupZipTemp(extractionId: string): void {
  const extraction = zipExtractions.get(extractionId)
  if (extraction === undefined) return

  revokeExtractedPaths(extraction)
  extraction.manager.cleanup()
  zipExtractions.delete(extractionId)
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
