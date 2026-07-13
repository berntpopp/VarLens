/**
 * SQLite-backed import executor.
 *
 * Wraps the existing worker-thread based single-file import pipeline behind
 * the cross-backend `StorageImportExecutor` contract. Behavior mirrors
 * `startImport` in `src/main/ipc/handlers/import-logic.ts` — this adapter
 * does not introduce new semantics, it only moves the orchestration behind
 * the storage-session abstraction so backends (SQLite, Postgres) can expose
 * the same surface to IPC handlers.
 *
 * Multi-file import (`importMultiFile`) is a thin adapter over the existing
 * `startMultiFileImport` function in `import-logic.ts`. A
 * `multiFileImportDelegate` option is accepted for test injection; the default
 * delegate calls `startMultiFileImport` directly. `getSession` is needed by
 * the default delegate so `startMultiFileImport` can reach the active executor
 * (it calls `startImport` internally for the first file).
 */
import { ImportWorkerClient } from '../../workers/import-worker-client'
import { mainLogger } from '../../services/MainLogger'
import { jobRunner } from '../../services/jobs/runner'
import { BedFilter } from '../../import/vcf/bed-filter'
import type { DatabaseService } from '../../database/DatabaseService'
import type { ImportFilters } from '../../import/vcf/import-filters'
import type { MultiFileImportResult, ImportCallbacks } from '../../ipc/handlers/import-logic'
import type { StorageSession } from '../session'
import type {
  StorageImportExecutor,
  StorageImportFileFilters,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult,
  StorageImportMultiFileParams,
  StorageImportMultiFileResult
} from '../import-executor'

/**
 * Injectable delegate for multi-file import — captures all arguments that
 * `startMultiFileImport` from `import-logic.ts` accepts, minus the closures
 * which the executor fills in from its own fields.
 */
export interface MultiFileImportDelegateInput {
  caseName: string
  files: StorageImportMultiFileParams['files']
  vcfOptions?: StorageImportMultiFileParams['vcfOptions']
  filters?: ImportFilters
  callbacks: ImportCallbacks
}

export type MultiFileImportDelegate = (
  input: MultiFileImportDelegateInput
) => Promise<MultiFileImportResult>

export interface SqliteImportExecutorOptions {
  getDatabaseService: () => DatabaseService
  createWorkerClient?: () => ImportWorkerClient
  /**
   * Injectable multi-file import function for testing.
   * Defaults to a delegate that calls `startMultiFileImport` from
   * `import-logic.ts` with `getSession` and `getDatabaseService` closures.
   */
  multiFileImportDelegate?: MultiFileImportDelegate
  /**
   * Required by the default `multiFileImportDelegate` so `startMultiFileImport`
   * can reach the active `StorageSession` when importing the first file.
   * Only needed when the default delegate is used; not required when
   * `multiFileImportDelegate` is injected for testing.
   */
  getSession?: () => StorageSession
}

export class SqliteImportExecutor implements StorageImportExecutor {
  private readonly getDatabaseService: () => DatabaseService
  private readonly createWorkerClient: () => ImportWorkerClient
  private readonly multiFileImportDelegate: MultiFileImportDelegate
  private readonly getSession: (() => StorageSession) | undefined
  private workerClient: ImportWorkerClient | null = null

  constructor(options: SqliteImportExecutorOptions) {
    this.getDatabaseService = options.getDatabaseService
    this.createWorkerClient = options.createWorkerClient ?? (() => new ImportWorkerClient())
    this.getSession = options.getSession
    this.multiFileImportDelegate = options.multiFileImportDelegate ?? this.buildDefaultDelegate()
  }

  /**
   * Builds the default delegate that calls `startMultiFileImport` from
   * `import-logic.ts`. Lazy-imported to avoid pulling Electron-only modules
   * into the test environment when a test-injected delegate is used instead.
   */
  private buildDefaultDelegate(): MultiFileImportDelegate {
    return async (input: MultiFileImportDelegateInput): Promise<MultiFileImportResult> => {
      const { startMultiFileImport } = await import('../../ipc/handlers/import-logic')
      const getSession = this.getSession
      if (getSession === undefined) {
        throw new Error(
          'SqliteImportExecutor: getSession is required for the default multiFileImportDelegate. ' +
            'Pass getSession in SqliteImportExecutorOptions or inject a multiFileImportDelegate.'
        )
      }
      return startMultiFileImport(
        input.caseName,
        input.files,
        input.vcfOptions,
        getSession,
        this.getDatabaseService,
        input.callbacks,
        input.filters
      )
    }
  }

  async importSingleFile(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    const handle = jobRunner.enqueue<StorageImportSingleFileParams, StorageImportSingleFileResult>(
      'import_single',
      params,
      async (ctx, p) => {
        // Cancellation posts { type: 'cancel' } to the worker via the client's
        // cancel() method (ImportWorkerClient.cancel), NOT terminate().
        ctx.registerCancel(() => this.workerClient?.cancel())
        return await this._performImport(p)
      }
    )
    return await handle.result
  }

  private _performImport(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    const db = this.getDatabaseService()
    const worker = this.createWorkerClient()
    this.workerClient = worker

    const { filePath, caseName, vcfOptions, throttleMs, onProgress } = params

    return new Promise<StorageImportSingleFileResult>((resolve, reject) => {
      let capturedCaseId = 0
      let capturedElapsed = 0
      let capturedSkipped = 0
      let capturedSkipReasons: string[] = []

      try {
        worker.start({
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
          throttleMs,
          onProgress: (msg) => {
            onProgress?.({
              phase: msg.phase === 'finalizing' ? 'inserting' : msg.phase,
              count: msg.variantCount,
              elapsed: 0,
              skipped: msg.skipped
            })
          },
          onFileComplete: (msg) => {
            capturedCaseId = msg.result.caseId
            capturedElapsed = msg.result.elapsed
            capturedSkipped = msg.result.skipped ?? 0
            capturedSkipReasons = msg.result.skipReasons ?? []
          },
          onComplete: (msg) => {
            this.workerClient = null

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
              onProgress?.({
                phase: 'inserting',
                count: detail.variantCount ?? 0,
                elapsed: 0,
                skipped: 0
              })

              try {
                db.variants.updateFrequencies(capturedCaseId)
              } catch (freqError) {
                mainLogger.warn(
                  `Failed to update variant frequencies: ${freqError instanceof Error ? freqError.message : String(freqError)}`,
                  'SqliteImportExecutor'
                )
              }

              resolve({
                caseId: capturedCaseId,
                variantCount: detail.variantCount ?? 0,
                skipped: capturedSkipped,
                errors: capturedSkipReasons,
                elapsed: capturedElapsed
              })
            } else {
              reject(new Error(detail?.error ?? 'Import failed'))
            }
          },
          onError: (msg) => {
            if (msg.fileIndex === -1) {
              this.workerClient = null
              reject(new Error(msg.error))
            }
          }
        })
      } catch (err) {
        // A synchronous throw from worker.start() (or an earlier construction
        // step) must not leave `this.workerClient` referencing a broken worker,
        // otherwise future imports hit the "already in progress" guard or
        // cancel() targets a stale client.
        this.workerClient = null
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  async importMultiFile(
    params: StorageImportMultiFileParams
  ): Promise<StorageImportMultiFileResult> {
    // Shares the 'import_single' JobKind with importSingleFile, mirroring
    // PostgresImportExecutor.importMultiFile: routing both paths through the same
    // runner kind gives a true cross-path single-flight (a running single-file
    // import blocks a multi-file import and vice versa). The multi-file path
    // goes through startMultiFileImport, which never sets `this.workerClient`,
    // so the cancel registration is best-effort (no-op unless a sibling
    // single-file worker happens to be referenced); the runner's per-kind
    // concurrency limit is what enforces exclusion here.
    const handle = jobRunner.enqueue<StorageImportMultiFileParams, StorageImportMultiFileResult>(
      'import_single',
      params,
      async (ctx, p) => {
        ctx.registerCancel(() => this.workerClient?.cancel())
        return await this._performMultiImport(p)
      }
    )
    return await handle.result
  }

  private async _performMultiImport(
    params: StorageImportMultiFileParams
  ): Promise<StorageImportMultiFileResult> {
    const startedAt = Date.now()
    const filters = await this.translateFilters(params.filters)

    // NOTE: params.onFileComplete is intentionally NOT plumbed through here.
    // The existing startMultiFileImport / ImportCallbacks shape in
    // src/main/ipc/handlers/import-logic.ts has no per-file completion
    // callback — only an onProgress fan-out with fileIndex/totalFiles
    // metadata embedded in the progress event. Callers that need a
    // dedicated onFileComplete signal (Task 13's PG multi-file path will
    // fire one per file) get nothing on the SQLite path until
    // startMultiFileImport gains a parallel callback.
    const callbacks: ImportCallbacks = {
      onProgress: (data) => {
        params.onProgress?.({
          phase: data.phase,
          count: data.count,
          elapsed: data.elapsed,
          skipped: data.skipped
        })
      }
      // No onFileComplete: see note above.
    }

    const result = await this.multiFileImportDelegate({
      caseName: params.caseName,
      files: params.files,
      vcfOptions: params.vcfOptions,
      filters,
      callbacks
    })

    return {
      caseId: result.caseId,
      variantCount: result.totalVariants,
      files: result.files,
      skipped: result.totalSkipped,
      // `errors` is intentionally always empty on the SQLite multi-file path:
      // per-file errors are surfaced in `result.files[].error` by startMultiFileImport,
      // not at the top level. The PG path (Task 11) follows the same convention.
      errors: [],
      elapsed: result.elapsed > 0 ? result.elapsed : Date.now() - startedAt
    }
  }

  /**
   * Translate `StorageImportFileFilters` (the storage-layer shape with
   * `bedFilePath`) into `ImportFilters` (the import-logic shape with a
   * `BedFilter` instance). Returns `undefined` when `filters` is absent or
   * contains no active constraints, mirroring the behaviour of
   * `buildImportFiltersFromIpc` in `import.ts`.
   */
  private async translateFilters(
    filters?: StorageImportFileFilters
  ): Promise<ImportFilters | undefined> {
    if (filters === undefined) return undefined

    const hasAny =
      (filters.bedFilePath !== undefined &&
        filters.bedFilePath !== null &&
        filters.bedFilePath !== '') ||
      filters.passOnly === true ||
      (filters.minQual !== undefined && filters.minQual !== null) ||
      (filters.minGq !== undefined && filters.minGq !== null) ||
      (filters.minDp !== undefined && filters.minDp !== null)

    if (!hasAny) return undefined

    let bedFilter: BedFilter | undefined
    if (
      filters.bedFilePath !== undefined &&
      filters.bedFilePath !== null &&
      filters.bedFilePath !== ''
    ) {
      bedFilter = await BedFilter.fromFile(filters.bedFilePath, filters.bedPadding ?? 0)
    }

    return {
      bedFilter,
      bedPadding: filters.bedPadding ?? 0,
      passOnly: filters.passOnly ?? false,
      minQual: filters.minQual ?? null,
      minGq: filters.minGq ?? null,
      minDp: filters.minDp ?? null
    }
  }

  cancel(): void {
    if (this.workerClient !== null) {
      this.workerClient.cancel()
    }
  }
}
