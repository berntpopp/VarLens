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
  StorageImportBatch,
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
import { ConflictError } from '../../ipc/errors'
import {
  openImportLease,
  WORKSPACE_IMPORT_BUSY_MESSAGE,
  type ImportLeaseClient
} from './postgres-import-lease'
import { Client } from 'pg'

export interface PostgresImportExecutorOptions {
  schema: string
  clientConfig: PostgresClientConfig
  workerClientFactory?: () => PostgresImportWorkerClient
  /** Connection that holds the workspace lock for a parallel batch. Default: a pg Client. */
  controlClientFactory?: () => ImportLeaseClient
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
    try {
      return await this.runSingleFile(params, undefined, (client) => {
        this.currentClient = client
      })
    } finally {
      this.currentClient = null
    }
  }

  /**
   * Open a batch whose files import concurrently, each in its own worker.
   * A control connection owns the workspace import lock for the whole batch
   * and runs interrupted-import recovery before the first worker and after
   * the last, so workers neither block nor clean up one another.
   */
  async openBatch(): Promise<StorageImportBatch> {
    const control = this.options.controlClientFactory?.() ?? this.createControlClient()
    const inFlight = new Set<PostgresImportWorkerClient>()
    let controlError: Error | null = null

    const onControlError = (err: Error): void => {
      controlError = err
      for (const client of inFlight) client.cancel()
    }
    const emitter = control as unknown as {
      on?: (event: string, fn: (err: Error) => void) => void
      off?: (event: string, fn: (err: Error) => void) => void
      removeListener?: (event: string, fn: (err: Error) => void) => void
    }
    if (typeof emitter.on === 'function') {
      emitter.on('error', onControlError)
    }

    const lease = await openImportLease(control, this.options.schema).catch((error: unknown) => {
      if (typeof emitter.off === 'function') {
        emitter.off('error', onControlError)
      } else if (typeof emitter.removeListener === 'function') {
        emitter.removeListener('error', onControlError)
      }
      if (error instanceof Error && error.message === WORKSPACE_IMPORT_BUSY_MESSAGE) {
        throw new ConflictError(error.message)
      }
      throw error
    })

    const failIfControlLost = (): void => {
      // Read through a function: TypeScript cannot see the listener's write.
      const lost = controlError as Error | null
      if (lost !== null) throw new Error(`Import batch control connection lost: ${lost.message}`)
    }

    return {
      importFile: async (params) => {
        failIfControlLost()
        let worker: PostgresImportWorkerClient | null = null
        try {
          const result = await this.runSingleFile(
            params,
            { holderPid: lease.holderPid, generation: lease.generation },
            (client) => {
              worker = client
              inFlight.add(client)
            }
          )
          // A lost control connection cancels the workers in flight, and a
          // cancelled worker resolves (case 0): that is no imported file.
          failIfControlLost()
          return result
        } finally {
          if (worker !== null) inFlight.delete(worker)
        }
      },
      cancelAll: () => {
        for (const client of inFlight) client.cancel()
      },
      close: async () => {
        try {
          if (controlError === null) {
            await lease.close()
          } else {
            // No recovery over a broken connection (the next import runs it),
            // but the client is still ended: if only the client side failed,
            // the session — and its workspace lock — would outlive the batch.
            // The listener stays for this: pg may report one loss twice.
            await control.end().catch(() => undefined)
          }
        } finally {
          if (typeof emitter.off === 'function') {
            emitter.off('error', onControlError)
          } else if (typeof emitter.removeListener === 'function') {
            emitter.removeListener('error', onControlError)
          }
        }
      }
    }
  }

  private createControlClient(): ImportLeaseClient {
    const config = this.options.clientConfig
    return new Client({
      connectionString: config.connectionString,
      application_name: config.application_name,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      keepAlive: config.keepAlive,
      ssl:
        config.ssl?.mode === 'require'
          ? { rejectUnauthorized: config.ssl.rejectUnauthorized }
          : undefined
    }) as unknown as ImportLeaseClient
  }

  private async runSingleFile(
    params: StorageImportSingleFileParams,
    lease: PostgresImportWorkerStartMessage['lease'],
    onClient: (client: PostgresImportWorkerClient) => void
  ): Promise<StorageImportSingleFileResult> {
    const startedAt = Date.now()
    const start: PostgresImportWorkerStartMessage = {
      type: 'start',
      client: this.options.clientConfig,
      schema: this.options.schema,
      mode: 'single-file',
      caseName: params.caseName,
      vcfOptions: params.vcfOptions,
      filePath: params.filePath,
      throttleMs: params.throttleMs,
      ...(lease !== undefined ? { lease } : {})
    }
    const result = await this.runWorker(start, params.onProgress, startedAt, undefined, onClient)
    return {
      caseId: result.caseId,
      variantCount: result.variantCount,
      skipped: result.skipped,
      errors: result.errors,
      elapsed: result.elapsed,
      ...(result.unrankedClinvar !== undefined ? { unrankedClinvar: result.unrankedClinvar } : {})
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
        elapsed: result.elapsed,
        ...(result.unrankedClinvar !== undefined ? { unrankedClinvar: result.unrankedClinvar } : {})
      }
    } finally {
      this.currentClient = null
    }
  }

  private runWorker(
    start: PostgresImportWorkerStartMessage,
    onProgress: StorageImportSingleFileParams['onProgress'],
    startedAt: number,
    onFileComplete?: StorageImportMultiFileParams['onFileComplete'],
    onClient: (client: PostgresImportWorkerClient) => void = (client) => {
      this.currentClient = client
    }
  ): Promise<{
    caseId: number
    variantCount: number
    files?: Array<{ filePath: string; variantType: string; variantCount: number; error?: string }>
    skipped: number
    errors: string[]
    elapsed: number
    unrankedClinvar?: string[]
  }> {
    const factory = this.options.workerClientFactory ?? (() => new PostgresImportWorkerClient())
    const client = factory()
    onClient(client)
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
            elapsed,
            ...(msg.result.unrankedClinvar !== undefined
              ? { unrankedClinvar: msg.result.unrankedClinvar }
              : {})
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
