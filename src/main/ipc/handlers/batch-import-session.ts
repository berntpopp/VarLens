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
 * `jobs:cancel` or the legacy cancel call); each file is a nested
 * `import_single` job through `startImport`.
 */
import { buildDuplicateReport, type DuplicateCheckItem } from '../../import/batch-utils'
import { jobRunner } from '../../services/jobs/runner'
import type { StorageSession } from '../../storage/session'
import type { StorageWriteTask } from '../../storage/write-executor'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import type { BatchProgress, BatchResult, DuplicateChoice } from '../../../shared/types/api'
import { resolveCaseName } from '../../../shared/utils/case-name'
import { cancelImport, startImport } from './import-logic'

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

/** Enqueue the batch as an `import_batch` job and wait for its result. */
export async function startSessionBatchImport(params: {
  files: SessionBatchFile[]
  duplicateStrategy: DuplicateChoice
  stripText?: string
  /** Client correlation id, echoed in the job params. */
  runId?: string
  session: StorageSession
  callbacks: SessionBatchCallbacks
}): Promise<BatchResult> {
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
  return await handle.result
}

/** The per-file loop. Exported for tests; production goes through the job. */
export async function runSessionBatchImport(params: {
  files: SessionBatchFile[]
  duplicateStrategy: DuplicateChoice
  stripText?: string
  session: StorageSession
  callbacks: SessionBatchCallbacks
  signal: AbortSignal
  ctx?: { reportProgress: (current: number, total: number, message?: string) => void }
}): Promise<BatchResult> {
  const { files, session, callbacks, signal } = params
  callbacks.onCohortStale?.({ is_stale: true })

  const existingIds = new Map((await session.listCases()).map((item) => [item.name, item.id]))
  const result: BatchResult = { succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }

  try {
    for (let index = 0; index < files.length; index++) {
      if (signal.aborted) {
        result.cancelled = true
        break
      }
      const file = files[index]
      // A case imported before `.vcf` was stripped resolves to its existing name.
      const { caseName } = resolveCaseName(file.fileName, params.stripText, (name) =>
        existingIds.has(name)
      )
      const base = { filePath: file.inputPath, fileName: file.fileName, caseName }
      params.ctx?.reportProgress(index, files.length, file.fileName)
      const existingId = existingIds.get(caseName)

      if (existingId !== undefined && params.duplicateStrategy === 'skip') {
        result.skipped++
        result.details.push({ ...base, status: 'skipped' })
        continue
      }

      try {
        if (existingId !== undefined) {
          await session
            .getWriteExecutor()
            .execute({ type: DELETE_CASE_TASK_TYPE, params: [existingId] } as StorageWriteTask)
          existingIds.delete(caseName)
        }
        const imported = await startImport(file.storedPath, caseName, undefined, () => session, {
          onProgress: (fileProgress) =>
            callbacks.onProgress?.({
              currentIndex: index,
              totalFiles: files.length,
              currentFileName: file.fileName,
              overallPercent: Math.round(((index + 1) / files.length) * 100),
              fileProgress
            })
        })
        result.succeeded++
        result.details.push({ ...base, status: 'success', variantCount: imported.variantCount })
        existingIds.set(caseName, imported.caseId)
      } catch (error) {
        if (signal.aborted) {
          result.cancelled = true
          break
        }
        result.failed++
        result.details.push({
          ...base,
          status: 'failed',
          error: formatErrorMessage(error, 'Import failed')
        })
      }
    }
    params.ctx?.reportProgress(files.length, files.length)
  } finally {
    callbacks.onCohortStale?.({ is_stale: false })
  }
  callbacks.onComplete?.(result)
  return result
}

/** Desktop (single user): cancel every running batch job. Web uses the owner-checked registry. */
export async function cancelActiveSessionBatch(): Promise<void> {
  const running = jobRunner.list({ kind: 'import_batch', status: 'running' })
  for (const job of running) await jobRunner.cancel(job.id)
}
