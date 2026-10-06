/**
 * PostgreSQL-backed import executor.
 *
 * Thin worker-dispatch layer: builds a start message and spawns a
 * PostgresImportWorkerClient, then maps the worker's complete/error
 * message back to the StorageImportExecutor contract. All parsing,
 * batching, and SQL writes happen in the postgres-import-worker.
 */
import { mainLogger } from '../../services/MainLogger'
import { jobRunner } from '../../services/jobs/runner'
import { withImportJobProgress } from '../import-job-progress'
import type {
  StorageImportExecutor,
  StorageImportSingleFileParams,
  StorageImportSingleFileResult,
  StorageImportMultiFileParams,
  StorageImportMultiFileResult
} from '../import-executor'
import { PostgresImportWorkerClient } from './PostgresImportWorkerClient'
import type { PostgresImportWorkerCallbacks } from './PostgresImportWorkerClient'
import type {
  PostgresImportWorkerStartMessage,
  PostgresClientConfig
} from '../../../shared/types/postgres-import-worker'
import { workerErrorToError } from '../import-worker-errors'

export interface PostgresImportExecutorOptions {
  schema: string
  clientConfig: PostgresClientConfig
  workerClientFactory?: () => PostgresImportWorkerClient
}

export class PostgresImportExecutor implements StorageImportExecutor {
  private currentClient: PostgresImportWorkerClient | null = null

  constructor(private readonly options: PostgresImportExecutorOptions) {}

  cancel(): void {
    this.currentClient?.cancel()
  }

  async importSingleFile(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    if ('filters' in (params as object)) {
      throw new Error('Filters are only supported on import:startMultiFile')
    }
    const handle = jobRunner.enqueue<StorageImportSingleFileParams, StorageImportSingleFileResult>(
      'import_single',
      params,
      async (ctx, p) => {
        // Cancellation posts { type: 'cancel' } to the worker via the client's
        // cancel() method (PostgresImportWorkerClient.cancel), NOT terminate().
        ctx.registerCancel(() => this.currentClient?.cancel())
        return await this._performImport(withImportJobProgress(ctx, p))
      }
    )
    return handle.result
  }

  private async _performImport(
    params: StorageImportSingleFileParams
  ): Promise<StorageImportSingleFileResult> {
    const startedAt = Date.now()
    try {
      const start: PostgresImportWorkerStartMessage = {
        type: 'start',
        client: this.options.clientConfig,
        schema: this.options.schema,
        mode: 'single-file',
        caseName: params.caseName,
        vcfOptions: params.vcfOptions,
        filePath: params.filePath,
        throttleMs: params.throttleMs
      }
      const result = await this.runWorker(start, params.onProgress, startedAt)
      return {
        caseId: result.caseId,
        variantCount: result.variantCount,
        skipped: result.skipped,
        errors: result.errors,
        elapsed: result.elapsed
      }
    } finally {
      this.currentClient = null
    }
  }

  async importMultiFile(
    params: StorageImportMultiFileParams
  ): Promise<StorageImportMultiFileResult> {
    // Shares the 'import_single' JobKind with importSingleFile (Pass-9 #9): the
    // pre-PR-4 `inProgress` flag gated BOTH paths, so cross-path mutual
    // exclusion between single- and multi-file imports is preserved by routing
    // both through the same runner kind. The flag is now gone — single-flight
    // is enforced entirely by the runner's per-kind concurrency limit.
    const handle = jobRunner.enqueue<StorageImportMultiFileParams, StorageImportMultiFileResult>(
      'import_single',
      params,
      async (ctx, p) => {
        // Cancellation posts { type: 'cancel' } to the worker via the client's
        // cancel() method (PostgresImportWorkerClient.cancel), NOT terminate().
        ctx.registerCancel(() => this.currentClient?.cancel())
        return await this._performMultiImport(withImportJobProgress(ctx, p))
      }
    )
    return handle.result
  }

  private async _performMultiImport(
    params: StorageImportMultiFileParams
  ): Promise<StorageImportMultiFileResult> {
    const startedAt = Date.now()
    try {
      const start: PostgresImportWorkerStartMessage = {
        type: 'start',
        client: this.options.clientConfig,
        schema: this.options.schema,
        mode: 'multi-file',
        caseName: params.caseName,
        files: params.files,
        vcfOptions: params.vcfOptions,
        throttleMs: params.throttleMs,
        filters: params.filters
          ? {
              bedFilePath: params.filters.bedFilePath ?? null,
              bedPadding: params.filters.bedPadding,
              passOnly: params.filters.passOnly,
              minQual: params.filters.minQual,
              minGq: params.filters.minGq,
              minDp: params.filters.minDp
            }
          : undefined
      }
      const result = await this.runWorker(
        start,
        params.onProgress,
        startedAt,
        params.onFileComplete
      )
      return {
        caseId: result.caseId,
        variantCount: result.variantCount,
        files: result.files ?? [],
        skipped: result.skipped,
        errors: result.errors,
        elapsed: result.elapsed
      }
    } finally {
      this.currentClient = null
    }
  }

  private runWorker(
    start: PostgresImportWorkerStartMessage,
    onProgress: StorageImportSingleFileParams['onProgress'],
    startedAt: number,
    onFileComplete?: StorageImportMultiFileParams['onFileComplete']
  ): Promise<{
    caseId: number
    variantCount: number
    files?: Array<{ filePath: string; variantType: string; variantCount: number; error?: string }>
    skipped: number
    errors: string[]
    elapsed: number
  }> {
    const factory = this.options.workerClientFactory ?? (() => new PostgresImportWorkerClient())
    const client = factory()
    this.currentClient = client
    return new Promise((resolvePromise, reject) => {
      const callbacks: PostgresImportWorkerCallbacks = {
        onProgress: (msg) => {
          onProgress?.({
            phase: msg.phase,
            count: msg.rowsProcessed,
            elapsed: Date.now() - startedAt,
            skipped: 0
          })
        },
        onFileComplete: (msg) => {
          onFileComplete?.({
            filePath: msg.filePath,
            caseId: msg.caseId,
            variantCount: msg.variantCount
          })
        },
        onComplete: (msg) => {
          // Use the worker-provided elapsed when available; otherwise fall back to wall clock.
          const elapsed = msg.result.elapsed > 0 ? msg.result.elapsed : Date.now() - startedAt
          resolvePromise({
            caseId: msg.result.caseId,
            variantCount: msg.result.variantCount,
            files: msg.result.files,
            skipped: msg.result.skipped,
            errors: msg.result.errors,
            elapsed
          })
        },
        onError: (msg) => {
          mainLogger.error(
            `PostgresImportExecutor worker error: ${msg.message}`,
            'PostgresImportExecutor'
          )
          reject(workerErrorToError(msg))
        }
      }
      client.start(start, callbacks)
    })
  }
}

// Re-exported for callers/tests that predate the shared module.
export { workerErrorToError }
