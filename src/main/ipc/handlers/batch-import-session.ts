/**
 * Backend-neutral batch import over a {@link StorageSession} (ADR 0002: one
 * implementation of the logic, runtime adapters only for transport).
 *
 * Used by the web server (Postgres) and by desktop when the active workspace
 * is a Postgres connection. Desktop on SQLite keeps the dedicated import
 * worker in batch-import-logic.ts, which writes all files on one worker
 * connection; both paths share the duplicate rule ({@link buildDuplicateReport})
 * and the result shape.
 *
 * Runs as one `import_batch` job (single-flight, cancellable via
 * `jobs:cancel` or the legacy cancel call). On a backend that can open a
 * batch, several files load at once on a bounded pool (batch-import-pool.ts);
 * otherwise each file is a nested `import_single` job through `startImport`.
 */
import { buildDuplicateReport, type DuplicateCheckItem } from '../../import/batch-utils'
import { jobRunner } from '../../services/jobs/runner'
import type { StorageSession } from '../../storage/session'
import type { StorageWriteTask } from '../../storage/write-executor'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { resolveImportConcurrency } from '../../storage/import-concurrency'
import type { StorageImportBatch } from '../../storage/import-executor'
import { API_CONFIG } from '../../../shared/config/api.config'
import type {
  BatchFileComplete,
  BatchProgress,
  BatchResult,
  DuplicateChoice
} from '../../../shared/types/api'
import { resolveCaseName } from '../../../shared/utils/case-name'
import { BatchProgressTracker, groupIntoChains, runChains } from './batch-import-pool'
import { cancelImport, startImport, withActiveImportOperation } from './import-logic'

/** One file of a batch: what the caller sent, where it is readable, its name. */
export interface SessionBatchFile {
  /** Echoed back in results (desktop path or web upload ref). */
  inputPath: string
  /** Path the importer reads. */
  storedPath: string
  fileName: string
}

export interface SessionBatchCallbacks {
  onProgress?: (progress: BatchProgress) => void
  onComplete?: (result: BatchResult) => void
  /** One file is done (imported, skipped or failed); its case is visible now. */
  onFileComplete?: (event: BatchFileComplete) => void
  onCohortStale?: (data: { is_stale: boolean }) => void
}

const DELETE_CASE_TASK_TYPE = 'cases:delete'

export { buildDuplicateReport }

export async function checkSessionDuplicates(
  session: Pick<StorageSession, 'listCases'>,
  files: ReadonlyArray<{ filePath: string; fileName: string }>,
  stripText?: string
): Promise<{ files: DuplicateCheckItem[]; duplicateCount: number }> {
  const existing = new Set((await session.listCases()).map((item) => item.name))
  return buildDuplicateReport(files, existing, stripText)
}

export interface SessionBatchParams {
  files: SessionBatchFile[]
  duplicateStrategy: DuplicateChoice
  stripText?: string
  /** Client correlation id, echoed in the job params. */
  runId?: string
  session: StorageSession
  callbacks: SessionBatchCallbacks
}

/** Enqueue the batch as an `import_batch` job and wait for its result. */
export async function startSessionBatchImport(params: SessionBatchParams): Promise<BatchResult> {
  return await enqueueSessionBatchImport(params).result
}

/**
 * Enqueue the batch as an `import_batch` job and return at once. The caller
 * owns `result`: it must be awaited or given a rejection handler.
 */
export function enqueueSessionBatchImport(params: SessionBatchParams): {
  jobId: string
  result: Promise<BatchResult>
} {
  const handle = jobRunner.enqueue(
    'import_batch',
    {
      fileCount: params.files.length,
      duplicateStrategy: params.duplicateStrategy,
      ...(params.runId !== undefined ? { runId: params.runId } : {})
    },
    async (ctx) => {
      ctx.registerCancel(cancelImport)
      return await runSessionBatchImport({ ...params, signal: ctx.signal, ctx })
    }
  )
  return { jobId: handle.id, result: handle.result }
}

/** How one file of a batch gets imported (sequential path or an open batch). */
type ImportOneFile = (
  file: SessionBatchFile,
  caseName: string,
  onProgress: (progress: NonNullable<BatchProgress['fileProgress']>) => void
) => Promise<{ caseId: number; variantCount: number; unrankedClinvar?: string[] }>

/**
 * Import the files of one batch. Exported for tests; production goes through
 * the job.
 *
 * With a backend that can open a batch (PostgreSQL) and a concurrency above
 * one, files load in parallel and each case appears as soon as it is done;
 * otherwise they are imported one by one. Either way the result lists the
 * files in the order they were given.
 */
export async function runSessionBatchImport(params: {
  files: SessionBatchFile[]
  duplicateStrategy: DuplicateChoice
  stripText?: string
  session: StorageSession
  callbacks: SessionBatchCallbacks
  signal: AbortSignal
  ctx?: { reportProgress: (current: number, total: number, message?: string) => void }
  /** Files imported at the same time. Default: {@link resolveImportConcurrency}. */
  concurrency?: number
}): Promise<BatchResult> {
  const { files, session, callbacks, signal } = params

  const existingIds = new Map((await session.listCases()).map((item) => [item.name, item.id]))
  // A case imported before `.vcf` was stripped resolves to its existing name.
  const caseNames = files.map(
    (file) =>
      resolveCaseName(file.fileName, params.stripText, (name) => existingIds.has(name)).caseName
  )
  const result: BatchResult = { succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }
  const details: Array<BatchResult['details'][number] | undefined> = new Array(files.length)
  const progress = new BatchProgressTracker(
    files.map((file) => file.fileName),
    (update) => callbacks.onProgress?.(update)
  )
  const reportJobProgress = (): void => {
    const running = progress.runningFileNames()
    const message =
      running.length > 1 ? `${running[0]} +${running.length - 1} more` : (running[0] ?? undefined)
    params.ctx?.reportProgress(progress.finishedFiles, files.length, message)
  }

  const remove = (params: Extract<StorageWriteTask, { type: 'cases:delete' }>['params']) =>
    session.getWriteExecutor().execute({ type: DELETE_CASE_TASK_TYPE, params })

  /** Delete the old case and give its name to the imported replacement, in one transaction. */
  const swapIn = async (oldId: number, newId: number, name: string): Promise<void> => {
    try {
      await remove([oldId, { id: newId, name }])
    } catch (error) {
      // Failed after the swap committed (the old case's purge resumes at the
      // next start): the replacement is in place. Before it: the old case stays.
      const cases = await session.listCases()
      if (cases.some((item) => item.id === newId && item.name === name)) return
      await remove([newId])
      throw error
    }
  }

  const processFile = async (index: number, importOne: ImportOneFile): Promise<void> => {
    if (signal.aborted) {
      result.cancelled = true
      return
    }
    const file = files[index]
    const caseName = caseNames[index]
    const base = { filePath: file.inputPath, fileName: file.fileName, caseName }
    const finish = (
      detail: BatchResult['details'][number],
      extra: Partial<BatchFileComplete>
    ): void => {
      details[index] = detail
      progress.finish(index)
      reportJobProgress()
      callbacks.onFileComplete?.({
        index,
        totalFiles: files.length,
        fileName: file.fileName,
        caseName,
        status: detail.status as BatchFileComplete['status'],
        ...extra
      })
    }
    progress.start(index)
    reportJobProgress()
    const existingId = existingIds.get(caseName)

    if (existingId !== undefined && params.duplicateStrategy === 'skip') {
      result.skipped++
      finish({ ...base, status: 'skipped' }, {})
      return
    }

    try {
      // The old case keeps its (UNIQUE) name until its replacement is imported (#493).
      const importName =
        existingId === undefined ? caseName : `${caseName} (replacing #${existingId})`
      // An overwrite that died before its swap left a case under this name: it
      // would block every retry on the UNIQUE name and count the person twice.
      const leftoverId = existingId === undefined ? undefined : existingIds.get(importName)
      if (leftoverId !== undefined) {
        await remove([leftoverId])
        existingIds.delete(importName)
      }
      const imported = await importOne(file, importName, (fileProgress) =>
        progress.update(index, fileProgress)
      )
      if (existingId !== undefined) await swapIn(existingId, imported.caseId, caseName)
      result.succeeded++
      existingIds.set(caseName, imported.caseId)
      const unranked =
        imported.unrankedClinvar !== undefined ? { unrankedClinvar: imported.unrankedClinvar } : {}
      finish(
        { ...base, status: 'success', variantCount: imported.variantCount, ...unranked },
        { caseId: imported.caseId, variantCount: imported.variantCount, ...unranked }
      )
    } catch (error) {
      if (signal.aborted) {
        result.cancelled = true
        return
      }
      result.failed++
      const message = formatErrorMessage(error, 'Import failed')
      finish({ ...base, status: 'failed', error: message }, { error: message })
    }
  }

  const executor = session.getImportExecutor()
  const concurrency = params.concurrency ?? resolveImportConcurrency()
  const parallel = concurrency > 1 && files.length > 1 && executor.openBatch !== undefined

  if (parallel) {
    await runFilesInParallel({
      openBatch: () => executor.openBatch!(),
      chains: groupIntoChains(caseNames),
      concurrency,
      processFile,
      shouldStop: () => signal.aborted
    })
    if (signal.aborted) result.cancelled = true
  } else {
    const importOne: ImportOneFile = (file, caseName, onProgress) =>
      startImport(file.storedPath, caseName, undefined, () => session, { onProgress })
    for (let index = 0; index < files.length && !result.cancelled; index++) {
      await processFile(index, importOne)
    }
  }
  if (!result.cancelled) params.ctx?.reportProgress(files.length, files.length)
  result.details = details.filter((detail) => detail !== undefined)
  callbacks.onComplete?.(result)
  return result
}

/**
 * The parallel path: one exclusive import operation that holds the workspace
 * for the whole batch, so a second import is refused once instead of failing
 * file by file, and a cancel reaches every file in flight.
 */
async function runFilesInParallel(args: {
  openBatch: () => Promise<StorageImportBatch>
  chains: number[][]
  concurrency: number
  processFile: (index: number, importOne: ImportOneFile) => Promise<void>
  shouldStop: () => boolean
}): Promise<void> {
  let batch: StorageImportBatch | null = null
  await withActiveImportOperation(
    () => batch?.cancelAll(),
    async () => {
      batch = await args.openBatch()
      const open = batch
      try {
        const importOne: ImportOneFile = (file, caseName, onProgress) =>
          open.importFile({
            filePath: file.storedPath,
            caseName,
            throttleMs: API_CONFIG.PROGRESS_THROTTLE_MS,
            onProgress
          })
        await runChains(
          args.chains,
          args.concurrency,
          (index) => args.processFile(index, importOne),
          args.shouldStop
        )
      } finally {
        await open.close()
      }
    }
  )
}

/** Desktop (single user): cancel every running batch job. Web uses the owner-checked registry. */
export async function cancelActiveSessionBatch(): Promise<void> {
  const running = jobRunner.list({ kind: 'import_batch', status: 'running' })
  for (const job of running) await jobRunner.cancel(job.id)
}
