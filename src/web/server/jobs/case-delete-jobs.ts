/**
 * Web/Postgres implementation of the backend-neutral `case_delete` job
 * (contract: src/shared/types/case-delete-job.ts, shared with the desktop
 * SQLite job from track 5a).
 *
 * Jobs run on a process-local {@link JobRunner} (same class as desktop, so
 * the `Job` snapshots, single-flight rule and cancel semantics are
 * identical). Each targeted case goes through PostgresCaseLifecycleRepository's
 * lock-free phases (hide → recompute → batched purge → finalize), so readers
 * never wait on a delete (blocking audit W-1).
 *
 * Progress: `current`/`total` count cases; `message` is a CaseDeletePhase.
 * Cancellation (`jobs:cancel`) is cooperative and lands between cases: every
 * case that was started is deleted completely. Server shutdown is different:
 * it aborts between purge batches, leaving the current case hidden
 * (import_status='deleting'); `resumePending()` finishes it at the next boot.
 */
import type {
  CaseDeletionPhase,
  PostgresCaseLifecycleRepository
} from '../../../main/storage/postgres/PostgresCaseLifecycleRepository'
import { CaseDeletionInterruptedError } from '../../../main/storage/postgres/PostgresCaseLifecycleRepository'
import { InvalidParametersError } from '../../../main/ipc/errors'
import type { JobHandle, JobRunner } from '../../../main/services/jobs/JobRunner'
import type {
  CaseDeleteJobResult,
  CaseDeletePhase,
  CaseDeleteTarget
} from '../../../shared/types/case-delete-job'
import type { Job } from '../../../shared/types/jobs'

export type CaseDeletionLifecycle = Pick<
  PostgresCaseLifecycleRepository,
  'getCaseStatus' | 'hideCase' | 'completeHiddenDeletion' | 'listPendingDeletions'
> & {
  hideAbandonedReplacements?: () => Promise<number[]>
  /** Ids of every visible ('ready') case, for `{ mode: 'all' }`. */
  listReadyCaseIds: () => Promise<number[]>
}

export interface CaseDeleteJobLogger {
  info: (obj: object, msg?: string) => void
  error: (obj: object, msg?: string) => void
}

export interface CaseDeleteJobRunnerOptions {
  lifecycle: CaseDeletionLifecycle
  runner: JobRunner
  logger?: CaseDeleteJobLogger
  batchSize?: number
  pauseBetweenBatchesMs?: number
  /** Called with every job snapshot together with the user that started it. */
  onJobChanged?: (job: Job, ownerUserId: number | undefined) => void
}

export class CaseNotFoundError extends Error {
  constructor(caseId: number) {
    super(`case ${caseId} not found`)
    this.name = 'CaseNotFoundError'
  }
}

/** Thrown inside the job when `jobs:cancel` lands; JobRunner marks it `cancelled`. */
class CaseDeleteCancelledError extends Error {
  constructor(readonly deleted: number) {
    super(`Case delete cancelled after ${deleted} case(s)`)
    this.name = 'AbortError'
  }
}

const PHASE_MAP: Record<CaseDeletionPhase, CaseDeletePhase> = {
  hiding: 'deleting',
  purging: 'deleting',
  finalizing: 'finalizing'
}

export class PostgresCaseDeleteJobs {
  private readonly shutdown = new AbortController()
  private readonly owners = new Map<string, number | undefined>()
  private readonly running = new Set<Promise<unknown>>()

  constructor(private readonly options: CaseDeleteJobRunnerOptions) {
    options.runner.onLifecycle((job) => {
      if (job.kind !== 'case_delete') return
      options.onJobChanged?.(snapshot(job), this.owners.get(job.id))
    })
  }

  /**
   * Start a `case_delete` job and return its handle immediately. Throws the
   * JobRunner single-flight error when a delete is already running.
   */
  start(target: CaseDeleteTarget, ownerUserId?: number): JobHandle<CaseDeleteJobResult> {
    const handle = this.options.runner.enqueue<CaseDeleteTarget, CaseDeleteJobResult>(
      'case_delete',
      target,
      (ctx, params) => this.run(params, ctx)
    )
    this.owners.set(handle.id, ownerUserId)
    // Lifecycle events fired inside enqueue() precede the owner mapping;
    // re-announce the running job so its owner sees it.
    const job = this.options.runner.get(handle.id)
    if (job !== undefined) this.options.onJobChanged?.(snapshot(job), ownerUserId)
    const tracked = handle.result.catch(() => undefined)
    this.running.add(tracked)
    void tracked.finally(() => this.running.delete(tracked))
    return handle
  }

  /** Synchronous validation for single-case deletes (404 / still importing). */
  async assertDeletable(caseId: number): Promise<void> {
    const status = await this.options.lifecycle.getCaseStatus(caseId)
    if (status === undefined) throw new CaseNotFoundError(caseId)
    if (status === 'importing') {
      throw new InvalidParametersError(
        `case ${caseId} is importing`,
        'This case is still being imported. Delete it after the import finishes.'
      )
    }
  }

  /** Re-run deletions interrupted by a crash or shutdown (cases already hidden). */
  async resumePending(): Promise<JobHandle<CaseDeleteJobResult> | undefined> {
    if (typeof this.options.lifecycle.hideAbandonedReplacements === 'function') {
      await this.options.lifecycle.hideAbandonedReplacements()
    }
    const pending = await this.options.lifecycle.listPendingDeletions()
    if (pending.length === 0) return undefined
    const ids = pending.map((p) => p.caseId)
    this.options.logger?.info(
      { event: 'case-delete', action: 'resume', caseIds: ids },
      'resuming interrupted case deletion'
    )
    return this.start({ mode: 'ids', ids })
  }

  /** Abort between purge batches and wait for the running job to stop. */
  async close(): Promise<void> {
    this.shutdown.abort()
    await Promise.all([...this.running])
  }

  private async run(
    target: CaseDeleteTarget,
    ctx: Parameters<Parameters<JobRunner['enqueue']>[2]>[0]
  ): Promise<CaseDeleteJobResult> {
    const { lifecycle } = this.options
    const ids = target.mode === 'all' ? await lifecycle.listReadyCaseIds() : target.ids
    let deleted = 0
    let phase: CaseDeletePhase = 'deleting'
    const report = (next: CaseDeletePhase): void => {
      phase = next
      ctx.reportProgress(deleted, ids.length, phase)
    }
    report('deleting')
    for (const caseId of ids) {
      if (ctx.signal.aborted) throw new CaseDeleteCancelledError(deleted)
      try {
        const hidden = await lifecycle.hideCase(caseId)
        if (hidden.state !== 'missing') {
          await lifecycle.completeHiddenDeletion(caseId, hidden, {
            batchSize: this.options.batchSize,
            pauseBetweenBatchesMs: this.options.pauseBetweenBatchesMs,
            signal: this.shutdown.signal,
            onProgress: (p) => {
              if (PHASE_MAP[p.phase] !== phase) report(PHASE_MAP[p.phase])
            }
          })
          deleted += 1
        }
      } catch (error) {
        if (error instanceof CaseDeletionInterruptedError) {
          this.options.logger?.info({ event: 'case-delete', action: 'interrupted', caseId })
        } else {
          this.options.logger?.error({ event: 'case-delete', action: 'failed', caseId, err: error })
        }
        throw error
      }
      report('deleting')
    }
    report('finalizing')
    return { deleted, cancelled: false }
  }
}

function snapshot(job: Job): Job {
  return { ...job, progress: job.progress && { ...job.progress } }
}
