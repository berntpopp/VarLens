import { parentPort } from 'node:worker_threads'
import { basename } from 'node:path'
import { statSync } from 'node:fs'
import type { Readable } from 'node:stream'
import { Client, type ClientConfig, type Pool, type PoolClient } from 'pg'

import {
  POSTGRES_IMPORT_CANCELLATION_MESSAGE,
  type PostgresImportWorkerInboundMessage,
  type PostgresImportWorkerOutboundMessage,
  type PostgresImportWorkerStartMessage,
  type PostgresClientConfig
} from '../../shared/types/postgres-import-worker'
import {
  PostgresJsonImportRepository,
  type PostgresJsonImportSession
} from '../storage/postgres/PostgresJsonImportRepository'
import {
  PostgresVcfImportRepository,
  type PostgresVcfImportRequest,
  type PostgresProvisionalImport
} from '../storage/postgres/PostgresVcfImportRepository'
import {
  profileStart,
  profileFlush,
  profilePhase,
  profileCount
} from '../storage/postgres/postgres-import-profile'
import { quoteIdentifier } from '../storage/postgres/identifiers'
import { classifyWorkerError } from '../storage/import-worker-errors'
import { lockSummaryForWrite } from '../storage/postgres/cohort-summary-lock'
import { publishDerivedDataForImport } from './postgres-import-publication'
import {
  acquireWorkspaceImportLock,
  assertImportLeaseHeld
} from '../storage/postgres/postgres-import-lease'
import {
  beginFencedImportTransaction,
  ImportSupersededError,
  inFencedImportTransaction,
  markImportConnection,
  type ImportFence
} from '../storage/postgres/postgres-import-fence'
import { DATABASE_CONFIG } from '../../shared/config'
import { createBoundedBatcher, getRecordBytes, resolveBatchSize } from '../import/bounded-batcher'
import { detectFormat as defaultDetectFormat } from '../import/format-detection'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { createMapperPipeline as defaultCreateMapperPipeline } from './import-pipeline'
import type { VcfMappedVariant } from '../import/vcf/types'
import { BedFilter } from '../import/vcf/bed-filter'
import type { ImportFilters } from '../import/vcf/import-filters'
import { splitVcfRows } from './postgres-vcf-batch'
import { streamMappedVcfRows } from './postgres-vcf-stream'

export { streamMappedVcfRows } from './postgres-vcf-stream'

const POSTGRES_JSON_IMPORT_BATCH_SIZE = 1000

let cancelled = false

// Diagnostic: surface any uncaught exception or unhandled rejection both via
// console.warn (stderr — visible during dev/E2E runs) AND, when the worker is
// running under a parent thread, as a structured `error` outbound message so
// the main process sees a real failure instead of a silently-crashing worker.
// Added to debug Phase 9 Task 15 (multi-file partial failure) where ENOENT
// was escaping the per-file try/catch — root cause was an unhandled error
// event on the readline-wrapped fs read stream.
process.on('uncaughtException', (err) => {
  console.warn('[postgres-import-worker] uncaughtException:', err.message, err.stack)
  parentPort?.postMessage({
    type: 'error',
    message: `uncaughtException: ${err.message}`,
    cause: err.stack
  } satisfies PostgresImportWorkerOutboundMessage)
})
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined

  console.warn(
    '[postgres-import-worker] unhandledRejection:',
    stack !== undefined ? `${message}\n${stack}` : message
  )
  parentPort?.postMessage({
    type: 'error',
    message: `unhandledRejection: ${message}`,
    cause: stack
  } satisfies PostgresImportWorkerOutboundMessage)
})

export interface RunImportDeps {
  createClient: (config: ClientConfig) => Client
  detectFormat: (filePath: string) => Promise<FormatInfo>
  createMapperPipeline: (filePath: string, formatInfo: FormatInfo) => Promise<Readable>
  statFile: (filePath: string) => { size: number }
  isCancellationRequested?: () => boolean
  /** Byte budget per batch; defaults to DATABASE_CONFIG.BATCH_INSERT_MAX_BYTES. */
  maxBatchBytes?: number
  /** VCF mapped-row producer for the PG worker's VCF branch. */
  createVcfMappedStream: (
    filePath: string,
    options: {
      selectedSample: string
      genomeBuild: string
      filters?: ImportFilters
      onSkip?: (reason: string) => void
    }
  ) => Promise<AsyncIterable<VcfMappedVariant>>
}

const defaultDeps: RunImportDeps = {
  createClient: (config) => new Client(config),
  detectFormat: defaultDetectFormat,
  createMapperPipeline: defaultCreateMapperPipeline,
  statFile: (path: string) => ({ size: statSync(path).size }),
  createVcfMappedStream: async (filePath, options) =>
    streamMappedVcfRows(filePath, options.selectedSample, options.filters, options.onSkip)
}

function recordParseSkip(args: { reason: string; errors: string[]; prefix?: string }): void {
  const { reason, errors, prefix } = args
  if (errors.length < 10) {
    errors.push(prefix === undefined ? reason : `${prefix}: ${reason}`)
  }
}

/**
 * Lift per-statement and idle-in-transaction limits for the import session.
 *
 * Phase 16.1 finding: a 5.3M-variant WGS import's post-loop bookkeeping
 * (`rebuildVariantFrequencyForCase` GROUP BY scan over the full case)
 * routinely takes longer than the renderer-default `statement_timeout`
 * of 30 s. Imports run in their own short-lived worker connection, so
 * relaxing the timeouts here doesn't affect read paths.
 */
export async function relaxImportSessionLimits(client: Pick<Client, 'query'>): Promise<void> {
  await client.query('SET statement_timeout = 0')
  await client.query('SET idle_in_transaction_session_timeout = 0')
  await client.query('SET lock_timeout = 0')
}

function clientConfigFromMessage(message: PostgresClientConfig): ClientConfig {
  return {
    connectionString: message.connectionString,
    application_name: message.application_name,
    connectionTimeoutMillis: message.connectionTimeoutMillis,
    statement_timeout: message.statement_timeout,
    // No client-side query timeout: publication steps and the wait for the
    // summary write lock are legitimately long, and the server-side limits
    // are lifted for this session anyway (relaxImportSessionLimits).
    query_timeout: 0,
    lock_timeout: message.lock_timeout,
    idle_in_transaction_session_timeout: message.idle_in_transaction_session_timeout,
    keepAlive: message.keepAlive,
    ssl:
      message.ssl?.mode === 'require'
        ? { rejectUnauthorized: message.ssl.rejectUnauthorized }
        : undefined
  }
}

export async function runImport(
  deps: RunImportDeps,
  start: PostgresImportWorkerStartMessage,
  post: (msg: PostgresImportWorkerOutboundMessage) => void
): Promise<void> {
  cancelled = false // reset at entry; the parentPort handler also resets, this covers test/direct paths
  const startedAt = Date.now()
  let batchSize = POSTGRES_JSON_IMPORT_BATCH_SIZE
  const maxBatchBytes = deps.maxBatchBytes ?? DATABASE_CONFIG.BATCH_INSERT_MAX_BYTES
  const client = deps.createClient(clientConfigFromMessage(start.client))
  let beganTransaction = false
  let provisionalImport: PostgresProvisionalImport | null = null
  let publicationCommitAttempted = false
  // Set before the first write. Every transaction that changes import state
  // starts through beginFenced / fenced (postgres-import-fence.ts).
  let fence: ImportFence = { schema: start.schema, generation: Number.NaN }
  const beginFenced = (): Promise<void> => beginFencedImportTransaction(client, fence)
  const fenced = <T>(operation: () => Promise<T>): Promise<T> =>
    inFencedImportTransaction(client, fence, operation)
  const isCancelled = (): boolean => cancelled || deps.isCancellationRequested?.() === true
  const throwIfCancelled = (): void => {
    if (isCancelled()) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
  }
  /** Wait for the summary write lock; a cancel during the wait ends as a cancel. */
  const lockSummary = async (queryable: Pick<PoolClient, 'query'>): Promise<void> => {
    try {
      await lockSummaryForWrite(queryable, start.schema, isCancelled)
    } catch (error) {
      throwIfCancelled()
      throw error
    }
  }

  try {
    batchSize = resolveBatchSize(start.batchSize, POSTGRES_JSON_IMPORT_BATCH_SIZE)
    await client.connect()
    profileStart(`${start.mode}:${start.caseName}`)
    // Phase 16.1: lift the per-statement / idle-in-transaction / lock
    // timeouts for the import session. Long post-loop bookkeeping
    // (rebuildVariantFrequencyForCase) on a WGS-sized case can exceed the
    // renderer-default 30 s statement_timeout. Auto-commit (no BEGIN
    // required) and per-session, so it does not leak to other connections.
    await profilePhase('relax-session-limits', () => relaxImportSessionLimits(client))
    await markImportConnection(client, start.schema)
    if (start.lease !== undefined) {
      await assertImportLeaseHeld(client, start.schema, start.lease.holderPid)
      fence = { schema: start.schema, generation: start.lease.generation }
    } else {
      await acquireWorkspaceImportLock(client, start.schema)
      const generation = await new PostgresVcfImportRepository(
        start.schema
      ).recoverInterruptedImports(client as unknown as Pick<PoolClient, 'query'>)
      fence = { schema: start.schema, generation }
    }

    if (start.mode === 'single-file') {
      const filePath = start.filePath
      if (filePath === undefined || filePath === '')
        throw new Error('postgres-import-worker: single-file mode requires filePath')

      // Always detect the concrete JSON sub-format (simple/object/columnar) regardless
      // of the hint — the hint isn't strong enough to skip detection because we need
      // caseKey/wrapped to select the correct mapper pipeline. Detection runs OUTSIDE
      // any transaction (it's a file-format sniffer; no DB work required), which lets
      // us decide whether to wrap the import in the VCF bracket transactions.
      const formatInfo = await deps.detectFormat(filePath)

      if (formatInfo.format === 'vcf') {
        // Phase 16.1: search_document is a STORED generated column on the
        // FTS-bearing tables (variants/variant_sv/variant_str), populated
        // inline at COPY/INSERT time. No trigger to disable, no bulk UPDATE
        // to defer, no bracket transactions, no recovery shim.
        {
          // Empty string lets streamMappedVcfRows auto-pick the first header
          // sample, matching the SQLite path; the generator throws cleanly if
          // the VCF has no selectable sample at all.
          const selectedSample = start.vcfOptions?.selectedSample ?? ''
          const genomeBuild = start.vcfOptions?.genomeBuild ?? 'GRCh38'
          const vcfFileName = basename(filePath)
          let vcfFileSize = 0
          try {
            vcfFileSize = deps.statFile(filePath).size
          } catch {
            // ignore — used only for provenance
          }

          const repo = new PostgresVcfImportRepository(start.schema)
          provisionalImport = await fenced(() =>
            repo.beginProvisionalImport(client as unknown as Pick<PoolClient, 'query'>, {
              caseName: start.caseName,
              filePath,
              fileSize: vcfFileSize,
              genomeBuild
            })
          )
          const caseId = provisionalImport.caseId
          // Single-file imports reject filters at the executor level, but pass
          // undefined defensively to keep the contract consistent.
          let totalSkipped = 0
          const errors: string[] = []
          const stream = await deps.createVcfMappedStream(filePath, {
            selectedSample,
            genomeBuild,
            filters: undefined,
            onSkip: (reason) => {
              totalSkipped += 1
              recordParseSkip({ reason, errors })
            }
          })

          let totalInserted = 0

          const writeBatch = async (rows: VcfMappedVariant[]): Promise<void> => {
            const request: PostgresVcfImportRequest = {
              mode: 'append',
              caseId,
              caseName: start.caseName,
              fileName: vcfFileName,
              filePath,
              fileSize: vcfFileSize,
              genomeBuild,
              caller: null,
              annotationFormat: null,
              variantType: 'snv-indel',
              ...splitVcfRows(rows)
            }
            await beginFenced()
            beganTransaction = true
            await client.query('SET LOCAL synchronous_commit = OFF')
            const variantCount = await profilePhase('writeVcfFile', () =>
              repo.writeVcfFile(client as unknown as Pick<PoolClient, 'query'>, request)
            )
            await client.query('COMMIT')
            beganTransaction = false
            profileCount('batch', 1)
            totalInserted += variantCount.variantCount
            post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
            if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
              ;(globalThis as { gc?: () => void }).gc?.()
            }
          }
          const batch = createBoundedBatcher<VcfMappedVariant, Promise<void>>({
            maxRows: batchSize,
            maxBytes: maxBatchBytes,
            flush: writeBatch
          })

          try {
            for await (const row of stream) {
              if (isCancelled()) {
                throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
              }
              if (batch.add(row, getRecordBytes(row))) await batch.flush()
            }
            await batch.flush()
            if (isCancelled()) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
          } catch (error) {
            if (beganTransaction) {
              await client.query('ROLLBACK')
              beganTransaction = false
            }
            throw error
          }

          throwIfCancelled()

          // Bookkeeping may scan millions of rows, but contains no production
          // COPY. MVCC keeps the previous ready snapshot visible until this
          // transaction publishes the case and every derived structure
          // together.
          await beginFenced()
          beganTransaction = true
          await client.query('SET LOCAL synchronous_commit = ON')
          await client.query(
            `UPDATE ${quoteIdentifier(start.schema)}."cases_all" SET variant_count = $1 WHERE id = $2`,
            [totalInserted, caseId]
          )
          if (totalInserted > 0) {
            // Derived data: prepared without the summary write lock, upserted
            // under it, all inside this publication transaction.
            await publishDerivedDataForImport({
              client,
              schema: start.schema,
              caseId,
              frequencyIncludesProvisional: true,
              lockSummary
            })
          }
          throwIfCancelled()
          await repo.finishProvisionalImport(
            client as unknown as Pick<PoolClient, 'query'>,
            caseId,
            vcfFileName,
            'vcf',
            fence
          )
          throwIfCancelled()
          publicationCommitAttempted = true
          await profilePhase('pub-commit', () => client.query('COMMIT'))
          beganTransaction = false
          provisionalImport = null
          publicationCommitAttempted = false

          profileFlush()
          post({
            type: 'complete',
            mode: 'single-file',
            result: {
              caseId,
              variantCount: totalInserted,
              skipped: totalSkipped,
              errors,
              elapsed: Date.now() - startedAt
            }
          })
          return
        }
      }

      // -------------------------------------------------------------------
      // Single-file JSON branch — no SET LOCAL synchronous_commit lever.
      // search_document is populated inline by STORED generated columns
      // on variants/variant_sv/variant_str (Phase 16.1), so the JSON path
      // gets correct FTS columns automatically without any extra work.
      // JSON imports keep the standard transaction shape since the WGS-
      // class tuning (per-batch async commit) is VCF-specific.
      // -------------------------------------------------------------------
      await beginFenced()
      beganTransaction = true

      const fileName = basename(filePath)
      let fileSize = 0
      try {
        fileSize = deps.statFile(filePath).size
      } catch {
        // ignore — used only for provenance
      }

      const repo = new PostgresJsonImportRepository(
        { connect: async () => client as unknown as PoolClient } as Pick<Pool, 'connect'>,
        start.schema
      )

      let totalInserted = 0
      const writeVariants = async (session: PostgresJsonImportSession): Promise<void> => {
        if (isCancelled()) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
        const stream = await deps.createMapperPipeline(filePath, formatInfo)
        const batch = createBoundedBatcher<Record<string, unknown>, Promise<void>>({
          maxRows: batchSize,
          maxBytes: maxBatchBytes,
          flush: async (rows) => {
            await session.insertVariantBatch(rows)
            totalInserted += rows.length
            post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
            if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
              ;(globalThis as { gc?: () => void }).gc?.()
            }
          }
        })
        try {
          for await (const chunk of stream) {
            if (isCancelled()) {
              stream.destroy()
              throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }
            if (chunk === null || chunk === undefined) continue
            if (batch.add(chunk as Record<string, unknown>, getRecordBytes(chunk as object))) {
              await batch.flush()
              if (isCancelled()) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }
          }
          if (!isCancelled()) {
            await batch.flush()
          } else {
            throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
          }
        } catch (err) {
          stream.destroy()
          throw err
        }
      }

      const importFileType =
        formatInfo.format === 'simple'
          ? 'simple'
          : formatInfo.format === 'object'
            ? 'object'
            : formatInfo.format === 'columnar'
              ? 'columnar'
              : (() => {
                  throw new Error(`Unsupported JSON format: ${formatInfo.format}`)
                })()

      const { caseId, variantCount } = await repo.writeJsonImport(
        client as unknown as Pick<PoolClient, 'query'>,
        {
          filePath,
          fileName,
          caseName: start.caseName,
          fileSize,
          genomeBuild: start.vcfOptions?.genomeBuild ?? 'GRCh38',
          importFileType
        },
        writeVariants
      )

      await publishDerivedDataForImport({
        client,
        schema: start.schema,
        caseId,
        frequencyIncludesProvisional: false,
        lockSummary
      })
      await client.query('COMMIT')
      post({
        type: 'complete',
        mode: 'single-file',
        result: {
          caseId,
          variantCount,
          skipped: 0,
          errors: [],
          elapsed: Date.now() - startedAt
        }
      })
      return
    }

    // -------------------------------------------------------------------------
    // Multi-file branch
    // -------------------------------------------------------------------------
    if (start.mode === 'multi-file') {
      if (!start.files || start.files.length === 0) {
        throw new Error('postgres-import-worker: multi-file mode requires non-empty files[]')
      }
      // Phase 16.1: search_document is a STORED generated column;
      // no trigger-defer machinery, no bracket transactions.
      {
        const fileResults: Array<{
          filePath: string
          variantType: string
          variantCount: number
          error?: string
        }> = []
        let caseId = 0
        let totalVariantCount = 0
        let totalSkipped = 0
        let lastSuccessfulFileName = ''
        const parseErrors: string[] = []
        const repo = new PostgresVcfImportRepository(start.schema)
        const selectedSample = start.vcfOptions?.selectedSample ?? ''
        const genomeBuild = start.vcfOptions?.genomeBuild ?? 'GRCh38'

        // Build ImportFilters once before the per-file loop so BED parsing runs
        // in the worker, not main. An explicit BED load must fail closed.
        let importFilters: ImportFilters | undefined
        if (start.filters !== undefined) {
          let bedFilter: BedFilter | undefined
          if (
            start.filters.bedFilePath !== null &&
            start.filters.bedFilePath !== undefined &&
            start.filters.bedFilePath !== ''
          ) {
            bedFilter = await BedFilter.fromFile(
              start.filters.bedFilePath,
              start.filters.bedPadding ?? 0
            )
          }
          importFilters = {
            bedFilter,
            // Match the SQLite-side IPC default (`payload.bedPadding ?? 0`) so the
            // same UI inputs include the same variants on both backends.
            bedPadding: start.filters.bedPadding ?? 0,
            passOnly: start.filters.passOnly ?? false,
            minQual: start.filters.minQual ?? null,
            minGq: start.filters.minGq ?? null,
            minDp: start.filters.minDp ?? null
          }
        }

        for (let i = 0; i < start.files.length; i += 1) {
          if (isCancelled()) break
          const fileSpec = start.files[i]
          const caseIdBeforeFile = caseId
          let fileVariantCount = 0
          let currentFileProvisional: PostgresProvisionalImport | null = null
          try {
            const fileName = basename(fileSpec.filePath)
            let fileSize = 0
            try {
              fileSize = deps.statFile(fileSpec.filePath).size
            } catch {
              // ignore — used only for provenance
            }
            let fileCaseId: number
            if (caseId === 0) {
              provisionalImport = await fenced(() =>
                repo.beginProvisionalImport(client as unknown as Pick<PoolClient, 'query'>, {
                  caseName: start.caseName,
                  filePath: fileSpec.filePath,
                  fileSize,
                  genomeBuild
                })
              )
              currentFileProvisional = provisionalImport
              fileCaseId = provisionalImport.caseId
            } else {
              const watermark = await repo.captureVariantWatermark(
                client as unknown as Pick<PoolClient, 'query'>,
                caseId
              )
              currentFileProvisional = { caseId, watermark, isNew: false }
              fileCaseId = caseId
            }

            const stream = await deps.createVcfMappedStream(fileSpec.filePath, {
              selectedSample,
              genomeBuild,
              filters: start.files.length > 1 && i === 0 ? undefined : importFilters,
              onSkip: (reason) => {
                totalSkipped += 1
                recordParseSkip({
                  reason,
                  errors: parseErrors,
                  prefix: basename(fileSpec.filePath)
                })
              }
            })

            const writeBatch = async (rows: VcfMappedVariant[]): Promise<void> => {
              const request: PostgresVcfImportRequest = {
                mode: 'append',
                caseId: fileCaseId,
                caseName: start.caseName,
                fileName,
                filePath: fileSpec.filePath,
                fileSize,
                genomeBuild,
                caller: fileSpec.caller ?? null,
                annotationFormat: fileSpec.annotationFormat ?? null,
                variantType: fileSpec.variantType,
                ...splitVcfRows(rows)
              }
              await beginFenced()
              beganTransaction = true
              await client.query('SET LOCAL synchronous_commit = OFF')
              const batchResult = await repo.writeVcfFile(
                client as unknown as Pick<PoolClient, 'query'>,
                request
              )
              await client.query('COMMIT')
              beganTransaction = false
              fileVariantCount += batchResult.variantCount
              post({
                type: 'progress',
                phase: 'inserting',
                rowsProcessed: totalVariantCount + fileVariantCount,
                filePath: fileSpec.filePath
              })
              if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
                ;(globalThis as { gc?: () => void }).gc?.()
              }
            }
            const batch = createBoundedBatcher<VcfMappedVariant, Promise<void>>({
              maxRows: batchSize,
              maxBytes: maxBatchBytes,
              flush: writeBatch
            })

            for await (const row of stream) {
              if (isCancelled()) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
              if (batch.add(row, getRecordBytes(row))) await batch.flush()
            }

            if (isCancelled()) {
              throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }

            await batch.flush()
            if (isCancelled()) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            caseId = fileCaseId
            totalVariantCount += fileVariantCount
            lastSuccessfulFileName = fileName
            fileResults.push({
              filePath: fileSpec.filePath,
              variantType: fileSpec.variantType,
              variantCount: fileVariantCount
            })
            post({
              type: 'file-complete',
              filePath: fileSpec.filePath,
              caseId,
              variantCount: fileVariantCount
            })
          } catch (err) {
            caseId = caseIdBeforeFile

            console.warn(
              `[postgres-import-worker] file ${i} (${fileSpec.filePath}) failed:`,
              err instanceof Error ? err.message : String(err)
            )
            // A superseded operation fails as a whole: no next file, and its
            // rows belong to the recovery that replaced it (outer handler).
            if (err instanceof ImportSupersededError) throw err
            try {
              if (beganTransaction) await client.query('ROLLBACK')
              beganTransaction = false
              if (currentFileProvisional !== null) {
                await repo.cleanupProvisionalImport(
                  client as unknown as Pick<PoolClient, 'query'>,
                  currentFileProvisional,
                  caseIdBeforeFile === 0
                    ? { fence }
                    : { restoreReady: false, preserveNewCase: true, fence }
                )
                if (caseIdBeforeFile === 0) provisionalImport = null
              }
            } catch (rollbackErr) {
              console.warn(
                `[postgres-import-worker] file ${i} ROLLBACK after error failed:`,
                rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
              )
              throw Object.assign(
                new Error(
                  `Failed to clean partial PostgreSQL rows for ${fileSpec.filePath}; import remains hidden for recovery`
                ),
                { cause: rollbackErr }
              )
            }
            const message = err instanceof Error ? err.message : String(err)
            if (message === POSTGRES_IMPORT_CANCELLATION_MESSAGE) break
            fileResults.push({
              filePath: fileSpec.filePath,
              variantType: fileSpec.variantType,
              variantCount: 0,
              error: message
            })
          }
        }

        // Post-loop bookkeeping — only if at least one file committed.
        if (caseId !== 0) {
          if (provisionalImport === null) {
            throw new Error('PostgreSQL import lost its provisional operation state')
          }
          throwIfCancelled()
          await beginFenced()
          beganTransaction = true
          // Force the final commit synchronous so the import only reports
          // success once the WAL is fsynced. Postgres flushes WAL up to this
          // commit's LSN, which transitively makes every earlier per-file
          // async commit durable on disk.
          await client.query('SET LOCAL synchronous_commit = ON')
          try {
            await client.query(
              `UPDATE ${quoteIdentifier(start.schema)}."cases_all" SET variant_count = $1 WHERE id = $2`,
              [totalVariantCount, caseId]
            )
            await publishDerivedDataForImport({
              client,
              schema: start.schema,
              caseId,
              frequencyIncludesProvisional: true,
              lockSummary
            })
            throwIfCancelled()
            await repo.finishProvisionalImport(
              client as unknown as Pick<PoolClient, 'query'>,
              caseId,
              lastSuccessfulFileName,
              'vcf',
              fence
            )
            throwIfCancelled()
            publicationCommitAttempted = true
            await client.query('COMMIT')
            beganTransaction = false
          } catch (err) {
            beganTransaction = false
            try {
              await client.query('ROLLBACK')
            } catch {
              // swallow
            }
            throw err
          }
          provisionalImport = null
          publicationCommitAttempted = false
        }

        profileFlush()
        post({
          type: 'complete',
          mode: 'multi-file',
          result: {
            caseId,
            variantCount: totalVariantCount,
            files: fileResults,
            skipped: totalSkipped,
            errors: isCancelled() ? [POSTGRES_IMPORT_CANCELLATION_MESSAGE] : parseErrors,
            elapsed: Date.now() - startedAt
          }
        })
        return
      }
    }

    throw new Error(
      `postgres-import-worker: unknown mode: ${String((start as { mode: string }).mode)}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (beganTransaction) {
      try {
        await client.query('ROLLBACK')
        beganTransaction = false
      } catch (rollbackErr) {
        // Worker has no mainLogger access; console.warn is the documented
        // worker exception (see AGENTS.md). Swallow but preserve diagnostics.
        console.warn(
          '[postgres-import-worker] ROLLBACK failed:',
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
        )
      }
    }
    if (provisionalImport !== null && !publicationCommitAttempted) {
      try {
        const repo = new PostgresVcfImportRepository(start.schema)
        await repo.cleanupProvisionalImport(
          client as unknown as Pick<PoolClient, 'query'>,
          provisionalImport,
          { fence }
        )
        provisionalImport = null
      } catch (cleanupError) {
        console.warn(
          '[postgres-import-worker] provisional import cleanup failed:',
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        )
      }
    }
    // Flush profile BEFORE post('error') / post('complete') — the worker
    // client terminates the worker thread on receipt, which can cut off
    // the trailing finally block before its file write completes.
    profileFlush()
    // Diagnostic: surface the actual worker error so failed perf runs are
    // analysable. The renderer test only sees an opaque IpcResult.
    if (message !== POSTGRES_IMPORT_CANCELLATION_MESSAGE) {
      console.warn('[postgres-import-worker] runImport failed:', message)
      if (err instanceof Error && err.stack !== undefined && err.stack !== '') {
        console.warn(err.stack)
      }
    }
    if (message === POSTGRES_IMPORT_CANCELLATION_MESSAGE) {
      post({
        type: 'complete',
        mode: start.mode,
        result: {
          caseId: 0,
          variantCount: 0,
          skipped: 0,
          errors: [POSTGRES_IMPORT_CANCELLATION_MESSAGE],
          elapsed: 0
        }
      })
    } else {
      post({ type: 'error', message, ...classifyWorkerError(err) })
    }
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(hashtext($1), hashtext('varlens-import'))`, [
        start.schema
      ])
    } catch {
      // Session close below also releases advisory locks.
    }
    try {
      await client.end()
    } catch {
      // swallow
    }
    profileFlush()
  }
}

if (parentPort) {
  const port = parentPort
  port.on('message', (msg: PostgresImportWorkerInboundMessage) => {
    if (msg.type === 'cancel') {
      cancelled = true
      return
    }
    if (msg.type === 'start') {
      cancelled = false
      void runImport(defaultDeps, msg, (out) => port.postMessage(out))
    }
  })
}
