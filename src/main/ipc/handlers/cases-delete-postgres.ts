/**
 * Bulk / all-case deletion for desktop on a Postgres workspace (PR-W9b).
 *
 * Track 5b left `cases.deleteMany` / `deleteAll` false in
 * POSTGRES_CAPABILITIES because enabling them routed desktop-on-Postgres into
 * the SQLite delete worker (`startSqliteCaseDeleteJob` opens the SQLite file).
 * This is the Postgres route: the same `case_delete` job contract
 * (src/shared/types/case-delete-job.ts) — progress per case, cooperative
 * cancel between cases — running each case through the session's write
 * executor (`cases:delete`, the path single deletes already use).
 *
 * The web server has its own lock-free variant (PostgresCaseDeleteJobs in
 * src/web/server/jobs), which needs the server's pool and boot-time resume.
 */
import { jobRunner } from '../../services/jobs/runner'
import type { JobHandle } from '../../services/jobs/JobRunner'
import { mainLogger } from '../../services/MainLogger'
import type { StorageSession } from '../../storage/session'
import type { CaseDeleteJobResult, CaseDeleteTarget } from '../../../shared/types/case-delete-job'
import { ConflictError } from '../errors'
import { acquireDeleteLock, releaseDeleteLock, type DeleteCallbacks } from './cases-logic'

class CaseDeleteCancelledError extends Error {
  constructor(readonly deleted: number) {
    super(`Case delete cancelled after ${deleted} case(s)`)
    this.name = 'AbortError'
  }
}

async function resolveTargetIds(session: StorageSession, target: CaseDeleteTarget) {
  if (target.mode === 'ids') return target.ids
  return (await session.listCases()).map((item) => item.id)
}

/** Start the job; returns at once. Single-flight with every other case delete. */
export function startPostgresCaseDeleteJob(
  target: CaseDeleteTarget,
  session: StorageSession,
  callbacks: DeleteCallbacks
): JobHandle<CaseDeleteJobResult> {
  if (!acquireDeleteLock()) {
    throw new ConflictError(
      'A delete operation is already in progress. Please wait for it to finish.'
    )
  }
  try {
    const handle = jobRunner.enqueue<CaseDeleteTarget, CaseDeleteJobResult>(
      'case_delete',
      target,
      async (ctx) => {
        const ids = await resolveTargetIds(session, target)
        let deleted = 0
        callbacks.onCohortStale?.({ is_stale: true })
        try {
          ctx.reportProgress(0, ids.length, 'deleting')
          for (const id of ids) {
            if (ctx.signal.aborted) throw new CaseDeleteCancelledError(deleted)
            await session.getWriteExecutor().execute({ type: 'cases:delete', params: [id] })
            deleted += 1
            ctx.reportProgress(deleted, ids.length, 'deleting')
          }
          ctx.reportProgress(deleted, ids.length, 'finalizing')
          return { deleted, cancelled: false }
        } finally {
          if (deleted > 0) callbacks.onDeleted?.({ deleted })
          callbacks.onCohortStale?.({ is_stale: false })
        }
      }
    )
    void handle.result
      .catch((error: unknown) => {
        if (!(error instanceof CaseDeleteCancelledError)) {
          mainLogger.error(`Postgres case delete job failed: ${String(error)}`, 'cases')
        }
      })
      .finally(releaseDeleteLock)
    return handle
  } catch (error) {
    releaseDeleteLock()
    throw error
  }
}
