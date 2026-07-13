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
  rebuildVariantFrequencyForCase,
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
import { PostgresCohortSummaryRepository } from '../storage/postgres/PostgresCohortSummaryRepository'
import { detectFormat as defaultDetectFormat } from '../import/format-detection'
import type { FormatInfo } from '../import/strategies/ImportStrategy'
import { createMapperPipeline as defaultCreateMapperPipeline } from './import-pipeline'
import type { VcfMappedVariant } from '../import/vcf/types'
import { BedFilter } from '../import/vcf/bed-filter'
import type { ImportFilters } from '../import/vcf/import-filters'
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

/**
 * C3 (Pass-2 #5 + Pass-3 HIGH #1 + Pass-4 HIGH #2 + Pass-5 HIGH #2): incremental
 * cohort-summary update for ONE imported case, run ONCE after the batch loop and
 * the bookkeeping rows (variant_count UPDATE + rebuildVariantFrequencyForCase),
 * still INSIDE the post-loop transaction the caller owns.
 *
 * The summary update is wrapped in a SAVEPOINT so a failure here cannot lose the
 * bookkeeping. On failure it rolls back to the savepoint (keeping count and
 * frequency work) and marks the summary stale inside the same publication
 * transaction. Staleness is not surfaced on ImportResult; the next cohort read
 * detects it and rebuilds.
 *
 * Returns `true` while preserving the historical caller contract. The caller
 * always retains the final publication transaction, including on stale-marking
 * fallback, so visibility cannot split across commits.
 */
async function updateCohortSummaryAfterImport(args: {
  client: Pick<Client, 'query'>
  schema: string
  caseId: number
  genomeBuild: string
}): Promise<boolean> {
  const { client, schema, caseId, genomeBuild } = args
  const summary = new PostgresCohortSummaryRepository()
  const scoped = client as unknown as Parameters<
    PostgresCohortSummaryRepository['incrementalAdd']
  >[0]['client']
  try {
    await client.query('SAVEPOINT cohort_summary')
    await summary.incrementalAdd({
      schema,
      client: scoped,
      caseId,
      genomeBuild,
      includeProvisional: true
    })
    await summary.recomputeCohortFrequency({
      schema,
      client: scoped,
      affectedBuilds: [genomeBuild],
      includeProvisional: true
    })
    await summary.refreshColumnMetas({
      schema,
      client: scoped,
      caseId,
      includeProvisional: true
    })
    await client.query('RELEASE SAVEPOINT cohort_summary')
    return true
  } catch (savepointErr) {
    await client.query('ROLLBACK TO SAVEPOINT cohort_summary')
    // Keep stale marking in the caller's final bookkeeping transaction.  The
    // case is still hidden at this point, so committing here would create a
    // crash window in which derived rows exist without a recoverable
    // publication marker.
    try {
      await summary.markStale({
        schema,
        client: scoped,
        reason: `post_import_summary_failed_case_${caseId}`
      })
    } catch (markErr) {
      const summaryMessage =
        savepointErr instanceof Error ? savepointErr.message : String(savepointErr)
      const staleMessage = markErr instanceof Error ? markErr.message : String(markErr)
      throw Object.assign(
        new Error(
          `Cohort summary update failed (${summaryMessage}) and stale marking failed (${staleMessage})`
        ),
        { cause: markErr }
      )
    }
    console.warn(
      `[postgres-import-worker] Cohort summary update failed for case ${caseId}; marked stale:`,
      savepointErr instanceof Error ? savepointErr.message : String(savepointErr)
    )
    return true
  }
}

function clientConfigFromMessage(message: PostgresClientConfig): ClientConfig {
  return {
    connectionString: message.connectionString,
    application_name: message.application_name,
    connectionTimeoutMillis: message.connectionTimeoutMillis,
    statement_timeout: message.statement_timeout,
    query_timeout: message.query_timeout,
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
  const batchSize =
    start.batchSize !== undefined && start.batchSize > 0
      ? start.batchSize
      : POSTGRES_JSON_IMPORT_BATCH_SIZE
  const client = deps.createClient(clientConfigFromMessage(start.client))
  let beganTransaction = false
  let provisionalImport: PostgresProvisionalImport | null = null
  let publicationCommitAttempted = false
  const isCancelled = (): boolean => cancelled || deps.isCancellationRequested?.() === true
  const throwIfCancelled = (): void => {
    if (isCancelled()) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
  }

  try {
    await client.connect()
    profileStart(`${start.mode}:${start.caseName}`)
    // Phase 16.1: lift the per-statement / idle-in-transaction / lock
    // timeouts for the import session. Long post-loop bookkeeping
    // (rebuildVariantFrequencyForCase) on a WGS-sized case can exceed the
    // renderer-default 30 s statement_timeout. Auto-commit (no BEGIN
    // required) and per-session, so it does not leak to other connections.
    await profilePhase('relax-session-limits', () => relaxImportSessionLimits(client))
    const lockResult = await client.query(
      `SELECT pg_try_advisory_lock(hashtext($1), hashtext('varlens-import')) AS locked`,
      [start.schema]
    )
    if ((lockResult.rows[0] as { locked?: boolean } | undefined)?.locked !== true) {
      throw new Error('An import operation is already in progress for this PostgreSQL workspace')
    }
    await new PostgresVcfImportRepository(start.schema).recoverInterruptedImports(
      client as unknown as Pick<PoolClient, 'query'>
    )

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
          provisionalImport = await repo.beginProvisionalImport(
            client as unknown as Pick<PoolClient, 'query'>,
            {
              caseName: start.caseName,
              filePath,
              fileSize: vcfFileSize,
              genomeBuild
            }
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

          let variants: Array<Record<string, unknown>> = []
          let transcripts: Array<Record<string, unknown> & { ordinal: number }> = []
          let sv: Array<Record<string, unknown> & { ordinal: number }> = []
          let cnv: Array<Record<string, unknown> & { ordinal: number }> = []
          let str: Array<Record<string, unknown> & { ordinal: number }> = []
          let ordinal = 0
          let totalInserted = 0

          const flush = async (): Promise<void> => {
            if (variants.length === 0) return
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
              variants,
              transcripts,
              sv,
              cnv,
              str
            }
            await client.query('BEGIN')
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
            variants = []
            transcripts = []
            sv = []
            cnv = []
            str = []
            ordinal = 0
            if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
              ;(globalThis as { gc?: () => void }).gc?.()
            }
          }

          try {
            for await (const row of stream) {
              if (cancelled) {
                throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
              }
              const { _transcripts, _sv, _cnv, _str, ...base } = row
              variants.push(base as unknown as Record<string, unknown>)
              if (Array.isArray(_transcripts)) {
                for (const t of _transcripts as unknown as Array<Record<string, unknown>>) {
                  transcripts.push({ ordinal, ...t })
                }
              }
              if (_sv !== undefined && _sv !== null) {
                sv.push({ ordinal, ...(_sv as unknown as Record<string, unknown>) })
              }
              if (_cnv !== undefined && _cnv !== null) {
                cnv.push({ ordinal, ...(_cnv as unknown as Record<string, unknown>) })
              }
              if (_str !== undefined && _str !== null) {
                str.push({ ordinal, ...(_str as unknown as Record<string, unknown>) })
              }
              ordinal += 1

              if (variants.length >= batchSize) {
                await flush()
              }
            }
            await flush()
            if (cancelled) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
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
          await client.query('BEGIN')
          beganTransaction = true
          await client.query('SET LOCAL synchronous_commit = ON')
          await client.query(
            `UPDATE ${quoteIdentifier(start.schema)}."cases_all" SET variant_count = $1 WHERE id = $2`,
            [totalInserted, caseId]
          )
          if (totalInserted > 0) {
            await rebuildVariantFrequencyForCase(
              client as unknown as Pick<PoolClient, 'query'>,
              start.schema,
              caseId,
              true
            )
            // C3: incremental cohort-summary update inside this txn (SAVEPOINT-
            // wrapped). On failure it rolls back only the summary savepoint
            // and records staleness in this same publication transaction.
            const stillOwnsTxn = await updateCohortSummaryAfterImport({
              client,
              schema: start.schema,
              caseId,
              genomeBuild
            })
            void stillOwnsTxn
          }
          throwIfCancelled()
          await repo.finishProvisionalImport(
            client as unknown as Pick<PoolClient, 'query'>,
            caseId,
            vcfFileName,
            'vcf'
          )
          throwIfCancelled()
          publicationCommitAttempted = true
          await client.query('COMMIT')
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
      await client.query('BEGIN')
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
        if (cancelled) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
        const stream = await deps.createMapperPipeline(filePath, formatInfo)
        let batch: Array<Record<string, unknown>> = []
        const flush = async (): Promise<void> => {
          if (batch.length === 0) return
          await session.insertVariantBatch(batch)
          totalInserted += batch.length
          batch = []
          post({ type: 'progress', phase: 'inserting', rowsProcessed: totalInserted, filePath })
          if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
            ;(globalThis as { gc?: () => void }).gc?.()
          }
        }
        try {
          for await (const chunk of stream) {
            if (cancelled) {
              stream.destroy()
              throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }
            if (chunk === null || chunk === undefined) continue
            batch.push(chunk as Record<string, unknown>)
            if (batch.length >= batchSize) {
              await flush()
              if (cancelled) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }
          }
          if (!cancelled) {
            await flush()
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

      await rebuildVariantFrequencyForCase(
        client as unknown as Pick<PoolClient, 'query'>,
        start.schema,
        caseId
      )
      // C3: incremental cohort-summary update inside this txn (SAVEPOINT-wrapped).
      {
        const stillOwnsTxn = await updateCohortSummaryAfterImport({
          client,
          schema: start.schema,
          caseId,
          genomeBuild: start.vcfOptions?.genomeBuild ?? 'GRCh38'
        })
        if (stillOwnsTxn) await client.query('COMMIT')
      }
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
          if (cancelled) break
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
              provisionalImport = await repo.beginProvisionalImport(
                client as unknown as Pick<PoolClient, 'query'>,
                {
                  caseName: start.caseName,
                  filePath: fileSpec.filePath,
                  fileSize,
                  genomeBuild
                }
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

            let variants: Array<Record<string, unknown>> = []
            let transcripts: Array<Record<string, unknown> & { ordinal: number }> = []
            let sv: Array<Record<string, unknown> & { ordinal: number }> = []
            let cnv: Array<Record<string, unknown> & { ordinal: number }> = []
            let str: Array<Record<string, unknown> & { ordinal: number }> = []
            let ordinal = 0

            const flushBatch = async (): Promise<void> => {
              if (variants.length === 0) return
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
                variants,
                transcripts,
                sv,
                cnv,
                str
              }
              await client.query('BEGIN')
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
              variants = []
              transcripts = []
              sv = []
              cnv = []
              str = []
              ordinal = 0
              if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
                ;(globalThis as { gc?: () => void }).gc?.()
              }
            }

            for await (const row of stream) {
              if (cancelled) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
              const { _transcripts, _sv, _cnv, _str, ...base } = row
              variants.push(base as unknown as Record<string, unknown>)
              if (Array.isArray(_transcripts)) {
                for (const t of _transcripts as unknown as Array<Record<string, unknown>>) {
                  transcripts.push({ ordinal, ...t })
                }
              }
              if (_sv !== undefined && _sv !== null) {
                sv.push({ ordinal, ...(_sv as unknown as Record<string, unknown>) })
              }
              if (_cnv !== undefined && _cnv !== null) {
                cnv.push({ ordinal, ...(_cnv as unknown as Record<string, unknown>) })
              }
              if (_str !== undefined && _str !== null) {
                str.push({ ordinal, ...(_str as unknown as Record<string, unknown>) })
              }
              ordinal += 1
              if (variants.length >= batchSize) await flushBatch()
            }

            if (cancelled) {
              throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
            }

            await flushBatch()
            if (cancelled) throw new Error(POSTGRES_IMPORT_CANCELLATION_MESSAGE)
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
            try {
              if (beganTransaction) await client.query('ROLLBACK')
              beganTransaction = false
              if (currentFileProvisional !== null) {
                await repo.cleanupProvisionalImport(
                  client as unknown as Pick<PoolClient, 'query'>,
                  currentFileProvisional,
                  caseIdBeforeFile === 0
                    ? undefined
                    : { restoreReady: false, preserveNewCase: true }
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
          await client.query('BEGIN')
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
            await rebuildVariantFrequencyForCase(
              client as unknown as Pick<PoolClient, 'query'>,
              start.schema,
              caseId,
              true
            )
            // C3: incremental cohort-summary update inside this txn (SAVEPOINT-
            // wrapped). On failure it records staleness without publishing a
            // partially updated derived snapshot.
            const stillOwnsTxn = await updateCohortSummaryAfterImport({
              client,
              schema: start.schema,
              caseId,
              genomeBuild
            })
            void stillOwnsTxn
            throwIfCancelled()
            await repo.finishProvisionalImport(
              client as unknown as Pick<PoolClient, 'query'>,
              caseId,
              lastSuccessfulFileName,
              'vcf'
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
            errors: cancelled ? [POSTGRES_IMPORT_CANCELLATION_MESSAGE] : parseErrors,
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
          provisionalImport
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
      post({ type: 'error', message })
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
