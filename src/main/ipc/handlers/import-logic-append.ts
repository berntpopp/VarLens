/**
 * Multi-file SQLite case: files 2..N are appended by the import worker in one
 * session (#551), not on the Electron main thread. The worker appends each
 * file in its own transaction (rows, variant_count, summary flag) and rebuilds
 * the cohort summary once at the session end (workers/import-append.ts).
 */
import type { DatabaseService } from '../../database/DatabaseService'
import { parseVcfHeader } from '../../import/vcf/vcf-header-parser'
import { ImportWorkerClient } from '../../workers/import-worker-client'
import { API_CONFIG } from '../../../shared/config/api.config'
import type { FileImportRequest } from '../../../shared/types/import-worker'
import type { VcfImportOptions } from './import-logic'

/** Outcome of one appended file; `error` set when it was not appended. */
export interface AppendedFile {
  variantCount: number
  skipped: number
  error?: string
  unrankedClinvar?: string[]
  afOutOfRange?: number
  csqAmbiguousSites?: number
}

export interface AppendFilesParams {
  db: DatabaseService
  caseId: number
  filePaths: string[]
  vcfOptions?: VcfImportOptions
  /** Filters as the worker takes them (it loads the BED file itself). */
  filters?: FileImportRequest['vcfFilters']
  /** Rows inserted so far into `filePaths[index]`. */
  onProgress?: (index: number, count: number, skipped: number) => void
  /** The worker flagged the cohort summary stale (it rebuilds before it ends). */
  onSummaryStale?: () => void
  signal?: AbortSignal
  createWorkerClient?: () => ImportWorkerClient
}

const NOT_IMPORTED = 'Not imported'

/**
 * Append every file to the published case in one worker session. Resolves
 * with one outcome per file, in order; each file is committed or rolled back
 * as a whole, also when the worker dies.
 */
export function appendFilesInWorker(p: AppendFilesParams): Promise<AppendedFile[]> {
  const outcomes: AppendedFile[] = p.filePaths.map(() => ({
    variantCount: 0,
    skipped: 0,
    error: NOT_IMPORTED
  }))
  const files: FileImportRequest[] = p.filePaths.map((filePath) => ({
    filePath,
    caseName: '',
    isDuplicate: false,
    duplicateStrategy: 'skip',
    appendToCaseId: p.caseId,
    vcfSelectedSamples:
      p.vcfOptions?.selectedSample != null && p.vcfOptions.selectedSample !== ''
        ? [p.vcfOptions.selectedSample]
        : undefined,
    fieldProfile: p.vcfOptions?.fieldProfile,
    vcfFilters: p.filters
  }))
  const client = (p.createWorkerClient ?? (() => new ImportWorkerClient()))()

  return new Promise<AppendedFile[]>((resolve) => {
    const cancel = (): void => client.cancel()
    p.signal?.addEventListener('abort', cancel, { once: true })
    const settle = (): void => p.signal?.removeEventListener('abort', cancel)
    client.start({
      files,
      dbPath: p.db.getPath(),
      encryptionKey: p.db.getEncryptionKey(),
      throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
      onProgress: (msg) => p.onProgress?.(msg.fileIndex, msg.variantCount, msg.skipped),
      onSummaryStale: () => p.onSummaryStale?.(),
      onFileComplete: (msg) => {
        const { variantCount, skipped, unrankedClinvar, afOutOfRange, csqAmbiguousSites } =
          msg.result
        outcomes[msg.fileIndex] = {
          variantCount,
          skipped: skipped ?? 0,
          unrankedClinvar,
          afOutOfRange,
          csqAmbiguousSites
        }
      },
      onError: (msg) => {
        if (msg.fileIndex >= 0) {
          outcomes[msg.fileIndex] = { variantCount: 0, skipped: 0, error: msg.error }
          return
        }
        // The worker died or failed as a whole: the files it reported are
        // committed, the one in flight was rolled back with the rest.
        settle()
        for (const outcome of outcomes)
          if (outcome.error === NOT_IMPORTED) outcome.error = msg.error
        resolve(outcomes)
      },
      onComplete: (msg) => {
        settle()
        msg.results.details.forEach((detail, index) => {
          if (detail.status === 'skipped') outcomes[index].error = detail.error ?? 'Skipped'
        })
        resolve(outcomes)
      }
    })
  })
}

/**
 * Parse the VCF header of an appended file and return its detected genome
 * build (or null if the header doesn't declare one).
 *
 * Used by the multi-file session to enforce a per-case genome build lock:
 * if a subsequent file declares a different build than the case was created
 * with, the file is refused before any variants are inserted.
 *
 * Delegates to the shared `parseVcfHeader`, which is already routed through
 * the capped reader (giant-line + decompression-bomb guards) -- see
 * stream-utils.ts for the cap rationale.
 */
export async function detectGenomeBuildFromFile(filePath: string): Promise<string | null> {
  const { header } = await parseVcfHeader(filePath)
  return header.genomeBuild ?? null
}
