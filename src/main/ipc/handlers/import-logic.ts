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
