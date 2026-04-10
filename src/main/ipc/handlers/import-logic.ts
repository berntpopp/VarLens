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

/** Callbacks for emitting events to the renderer during import operations. */
export interface ImportCallbacks {
  onProgress?: (data: { phase: string; count: number; elapsed: number; skipped: number }) => void
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
 * the worker). Remaining files are appended on the main thread via
 * importAdditionalFileToCase and recorded in case_import_files.
 *
 * The cohort summary is NOT rebuilt here — the caller should trigger a
 * rebuild once after the multi-file session completes so cohort counts
 * are updated only once, not per file.
 */
export async function startMultiFileImport(
  caseName: string,
  files: MultiFileImportSpec[],
  vcfOptions: VcfImportOptions | undefined,
  getDb: () => DatabaseService,
  callbacks: ImportCallbacks
): Promise<MultiFileImportResult> {
  const startTime = Date.now()

  if (files.length === 0) {
    throw new Error('No files provided for import')
  }

  const db = getDb()
  const { statSync } = await import('node:fs')
  const { importAdditionalFileToCase } = await import('./import-logic-append')

  // Import first file — creates the case
  const firstFile = files[0]
  const firstResult = await startImport(firstFile.filePath, caseName, vcfOptions, getDb, callbacks)

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

  // Append remaining files into the same case
  for (let i = 1; i < files.length; i++) {
    const spec = files[i]
    try {
      const fileSize = statSync(spec.filePath).size

      const result = await importAdditionalFileToCase(
        caseId,
        spec.filePath,
        vcfOptions,
        getDb,
        callbacks
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
