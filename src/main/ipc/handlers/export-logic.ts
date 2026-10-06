/**
 * Pure business logic for export IPC handlers.
 *
 * All functions take explicit dependencies (db, callbacks) as parameters
 * and never touch IPC/Electron APIs directly. This makes them testable
 * without mocking Electron internals.
 */
import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { mainLogger } from '../../services/MainLogger'
import { jobRunner } from '../../services/jobs/runner'
import type { JobContext } from '../../services/jobs/JobRunner'
import { ExportWorkerClient } from '../../workers/export-worker-client'
import { COHORT_EXPORT_COLUMNS } from '../../workers/cohort-export'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DbPool } from '../../database/DbPool'
import type { VariantFilter } from '../../database/types'
import type { CohortSearchParams } from '../../../shared/types/cohort'
import type { ExportFilterSummary } from '../../../shared/types/export-worker'
import { EXPORT_COLUMNS, type ExportColumn } from '../../workers/export-pipeline'
import { csvEscape, formatCellValue } from '../../workers/export-renderer'
import { buildVariantFilter } from './variants-logic'

const EXPORT_HARD_LIMIT = 100_000

/** Callbacks for emitting events to the renderer during export. */
export interface ExportCallbacks {
  onProgress?: (data: { current: number; total: number }) => void
}

/** Result type for export operations. */
export interface ExportResult {
  success: boolean
  filePath?: string
  error?: string
}

const CANCELLED_RESULT: ExportResult = { success: false, error: 'Export cancelled' }

/**
 * Run an export as a tracked `export` job so it shows up in `jobs:changed`
 * and can be cancelled via `export:cancel` / `jobs:cancel`. The JobRunner's
 * per-kind single-flight rejects a second concurrent export.
 */
function runExportJob(
  label: string,
  run: (ctx: JobContext) => Promise<ExportResult>
): Promise<ExportResult> {
  return jobRunner.enqueue<{ label: string }, ExportResult>('export', { label }, (ctx) => run(ctx))
    .result
}

/**
 * Cancel the running export job, if any. Resolves `true` when a running
 * export was asked to stop.
 */
export async function cancelActiveExport(): Promise<boolean> {
  const running = jobRunner.list({ kind: 'export', status: 'running' })
  for (const job of running) await jobRunner.cancel(job.id)
  return running.length > 0
}

/** Bridge an export worker into a job: progress, cancel and completion. */
function runWorkerExport(
  ctx: JobContext,
  callbacks: ExportCallbacks,
  start: (client: ExportWorkerClient, hooks: WorkerExportHooks) => void
): Promise<ExportResult> {
  const workerClient = new ExportWorkerClient()
  return new Promise<ExportResult>((resolve) => {
    ctx.registerCancel(() => workerClient.cancel())
    start(workerClient, {
      onProgress: (current, total) => {
        ctx.reportProgress(current, total)
        callbacks.onProgress?.({ current, total })
      },
      onComplete: (filePath, rowCount) => {
        mainLogger.info(`Export complete: ${rowCount} rows to ${filePath}`, 'export')
        resolve({ success: true, filePath })
      },
      onError: (error) => {
        mainLogger.error(`Export worker error: ${error}`, 'export')
        resolve({ success: false, error })
      },
      onCancelled: () => {
        mainLogger.info('Export cancelled by user', 'export')
        resolve(CANCELLED_RESULT)
      }
    })
  })
}

interface WorkerExportHooks {
  onProgress: (current: number, total: number) => void
  onComplete: (filePath: string, rowCount: number) => void
  onError: (error: string) => void
  onCancelled: () => void
}

/**
 * Pre-check variant count and compile export query.
 * If the count exceeds the hard limit, returns an ExportResult with success: false.
 * The count runs in the read pool when one is available (it can be a
 * whole-case `count(*)`); compiling the SQL is cheap and stays on main.
 */
export async function prepareVariantExport(
  getDb: () => DatabaseService,
  caseId: number,
  filters: Partial<VariantFilter>,
  getDbPool?: () => DbPool | null
): Promise<
  | {
      compiled: { sql: string; parameters: readonly unknown[] }
      count: number
    }
  | ExportResult
> {
  const db = getDb()
  // Resolve the active gene panel exactly as the on-screen query does
  // (buildVariantFilter): the compiled export SQL only understands
  // `panel_intervals`, so an unresolved `active_panel_ids` would export the
  // whole case while the table shows the panel-restricted set (issue #447).
  const fullFilter = buildVariantFilter(caseId, filters, getDb)
  const dbPool = getDbPool?.() ?? null
  const count =
    dbPool !== null
      ? await dbPool.run<number>({ type: 'variants:exportCount', params: [fullFilter] })
      : db.variants.getExportCount(fullFilter)

  if (count > EXPORT_HARD_LIMIT) {
    return {
      success: false,
      error: `Export limited to ${EXPORT_HARD_LIMIT.toLocaleString()} variants. Current filter matches ${count.toLocaleString()} variants. Please narrow your filters.`
    }
  }

  const compiled = db.variants.compileExportQuery(fullFilter, EXPORT_HARD_LIMIT)
  return { compiled, count }
}

/**
 * Build filter summary for metadata sheet from variant filters.
 */
export function buildFilterSummary(filters: Partial<VariantFilter>): ExportFilterSummary {
  return {
    ...(filters.gene_symbol !== undefined && filters.gene_symbol !== ''
      ? { gene_symbol: filters.gene_symbol }
      : {}),
    ...(filters.consequences !== undefined && filters.consequences.length > 0
      ? { consequences: filters.consequences }
      : {}),
    ...(filters.funcs !== undefined && filters.funcs.length > 0 ? { funcs: filters.funcs } : {}),
    ...(filters.clinvars !== undefined && filters.clinvars.length > 0
      ? { clinvars: filters.clinvars }
      : {}),
    ...(filters.gnomad_af_max !== undefined ? { gnomad_af_max: filters.gnomad_af_max } : {}),
    ...(filters.cadd_min !== undefined ? { cadd_min: filters.cadd_min } : {})
  }
}

/**
 * Export variants to XLSX via worker thread.
 *
 * Callers must run {@link prepareVariantExport} first (before showing any
 * save-dialog) and pass the resulting `compiled` query here. This avoids a
 * redundant count query and, more importantly, ensures users are never asked
 * to pick a file path only to be told the export exceeds the hard limit.
 */
export function exportVariants(
  getDb: () => DatabaseService,
  compiled: { sql: string; parameters: readonly unknown[] },
  filters: Partial<VariantFilter>,
  caseName: string,
  outputFilePath: string,
  callbacks: ExportCallbacks
): Promise<ExportResult> {
  const db = getDb()
  const filterSummary = buildFilterSummary(filters)

  return runExportJob('variants', (ctx) =>
    runWorkerExport(ctx, callbacks, (client, hooks) =>
      client.start({
        dbPath: db.getPath(),
        encryptionKey: db.getEncryptionKey(),
        compiledSql: compiled.sql,
        compiledParams: compiled.parameters,
        outputFilePath,
        caseName,
        filterSummary,
        ...hooks
      })
    )
  )
}

async function exportRowsToCsv(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  columns: readonly ExportColumn[],
  callbacks: ExportCallbacks,
  label: string,
  signal?: AbortSignal
): Promise<ExportResult> {
  const stream = createWriteStream(outputFilePath, { encoding: 'utf8' })

  const writeLine = async (line: string): Promise<void> => {
    if (stream.write(`${line}\r\n`)) {
      return
    }

    await Promise.race([
      once(stream, 'drain'),
      once(stream, 'error').then(([error]) => Promise.reject(error))
    ])
  }

  try {
    await Promise.race([
      once(stream, 'open'),
      once(stream, 'error').then(([error]) => Promise.reject(error))
    ])
    await writeLine(columns.map((column) => csvEscape(column.header)).join(','))

    let rowCount = 0
    for await (const row of rows) {
      if (signal?.aborted === true) {
        stream.destroy()
        mainLogger.info(`${label} cancelled after ${rowCount} rows`, 'export')
        return CANCELLED_RESULT
      }
      const line = columns
        .map((column) => csvEscape(formatCellValue(column.key, row[column.key])))
        .join(',')
      await writeLine(line)
      rowCount += 1

      if (rowCount % 1000 === 0) {
        callbacks.onProgress?.({ current: rowCount, total: 0 })
      }
    }

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve)
      stream.on('error', reject)
      stream.end()
    })

    mainLogger.info(`${label} complete: ${rowCount} rows to ${outputFilePath}`, 'export')
    return { success: true, filePath: outputFilePath }
  } catch (error) {
    stream.destroy()
    const message = error instanceof Error ? error.message : String(error)
    mainLogger.error(`${label} error: ${message}`, 'export')
    return { success: false, error: message }
  }
}

export function exportPostgresVariants(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  callbacks: ExportCallbacks
): Promise<ExportResult> {
  return runExportJob('postgres-variants', (ctx) =>
    exportRowsToCsv(
      rows,
      outputFilePath,
      EXPORT_COLUMNS,
      callbacks,
      'PostgreSQL variant export',
      ctx.signal
    )
  )
}

export function exportPostgresCohort(
  rows: AsyncIterable<Record<string, unknown>>,
  outputFilePath: string,
  callbacks: ExportCallbacks
): Promise<ExportResult> {
  return runExportJob('postgres-cohort', (ctx) =>
    exportRowsToCsv(
      rows,
      outputFilePath,
      COHORT_EXPORT_COLUMNS,
      callbacks,
      'PostgreSQL cohort export',
      ctx.signal
    )
  )
}

/**
 * Export cohort variants to XLSX. The cohort query (≤100k rows) and the
 * workbook build run in the export worker; progress is relayed and the job
 * can be cancelled.
 */
export function exportCohort(
  getDb: () => DatabaseService,
  params: CohortSearchParams,
  outputFilePath: string,
  callbacks: ExportCallbacks = {}
): Promise<ExportResult> {
  const db = getDb()
  return runExportJob('cohort', (ctx) =>
    runWorkerExport(ctx, callbacks, (client, hooks) =>
      client.startCohort({
        dbPath: db.getPath(),
        encryptionKey: db.getEncryptionKey(),
        params,
        outputFilePath,
        ...hooks
      })
    )
  )
}
