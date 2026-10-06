/**
 * Web runner for non-blocking case deletion (2026-10 blocking audit, W-1).
 *
 * `start()` validates the case synchronously (404 / "still importing"
 * surface on the request), registers a `case-delete` BackgroundJob and
 * returns it immediately; the work runs on a serial queue — one deletion at
 * a time, so purges never hold more than one pool connection — using
 * PostgresCaseLifecycleRepository's lock-free phases. Readers stop seeing the
 * case as soon as the hide phase commits.
 *
 * `resumePending()` re-queues cases left in import_status='deleting' by a
 * crash or shutdown. `close()` aborts between purge batches; the case stays
 * hidden and resumes at the next boot.
 */
import type {
  CaseDeletionProgress,
  PostgresCaseLifecycleRepository
} from '../../../main/storage/postgres/PostgresCaseLifecycleRepository'
import { CaseDeletionInterruptedError } from '../../../main/storage/postgres/PostgresCaseLifecycleRepository'
import { InvalidParametersError } from '../../../main/ipc/errors'
import type { BackgroundJob } from '../../../shared/types/background-job'
import type { BackgroundJobRegistry } from './background-job-registry'

export type CaseDeletionLifecycle = Pick<
  PostgresCaseLifecycleRepository,
  'getCaseStatus' | 'hideCase' | 'completeHiddenDeletion' | 'listPendingDeletions'
>

export interface CaseDeleteJobLogger {
  info: (obj: object, msg?: string) => void
  error: (obj: object, msg?: string) => void
}

export interface CaseDeleteJobRunnerOptions {
  lifecycle: CaseDeletionLifecycle
  registry: BackgroundJobRegistry
  logger?: CaseDeleteJobLogger
  batchSize?: number
  pauseBetweenBatchesMs?: number
  /** Minimum ms between progress updates published for one job. */
  progressIntervalMs?: number
  /** Called after a job reaches a terminal state (e.g. to emit SSE events). */
  onSettled?: (job: BackgroundJob, ownerUserId: number | undefined) => void
}

export class CaseNotFoundError extends Error {
  constructor(caseId: number) {
    super(`case ${caseId} not found`)
    this.name = 'CaseNotFoundError'
  }
}

export class CaseDeleteJobRunner {
  private queue: Promise<void> = Promise.resolve()
  private readonly abort = new AbortController()
  private readonly progressIntervalMs: number

  constructor(private readonly options: CaseDeleteJobRunnerOptions) {
    this.progressIntervalMs = options.progressIntervalMs ?? 500
  }

  async start(caseId: number, ownerUserId?: number): Promise<BackgroundJob> {
    const subject = { type: 'case' as const, id: caseId }
    const existing = this.options.registry.findActive('case-delete', subject)
    if (existing !== undefined) return existing

    const status = await this.options.lifecycle.getCaseStatus(caseId)
    if (status === undefined) throw new CaseNotFoundError(caseId)
    if (status === 'importing') {
      throw new InvalidParametersError(
        `case ${caseId} is importing`,
        'This case is still being imported. Delete it after the import finishes.'
      )
    }
    return this.enqueue(caseId, ownerUserId)
  }

  /** Re-queue deletions interrupted by a crash or shutdown. */
  async resumePending(): Promise<BackgroundJob[]> {
    const pending = await this.options.lifecycle.listPendingDeletions()
    return pending.map(({ caseId }) => {
      this.options.logger?.info(
        { event: 'case-delete', action: 'resume', caseId },
        'resuming interrupted case deletion'
      )
      return (
        this.options.registry.findActive('case-delete', { type: 'case', id: caseId }) ??
        this.enqueue(caseId, undefined)
      )
    })
  }

  /** Wait for the queue to drain (tests, measurement). */
  async idle(): Promise<void> {
    await this.queue
  }

  async close(): Promise<void> {
    this.abort.abort()
    await this.queue
  }

  private enqueue(caseId: number, ownerUserId: number | undefined): BackgroundJob {
    const job = this.options.registry.create(
      'case-delete',
      { type: 'case', id: caseId },
      ownerUserId
    )
    this.queue = this.queue.then(() => this.run(job.id, caseId, ownerUserId))
    return job
  }

  private async run(jobId: string, caseId: number, ownerUserId: number | undefined): Promise<void> {
    const { registry, lifecycle } = this.options
    if (this.abort.signal.aborted) return
    registry.update(jobId, {
      status: 'running',
      startedAt: Date.now(),
      progress: { phase: 'hiding', done: 0, total: null }
    })
    const reportProgress = this.progressReporter(jobId)
    try {
      const hidden = await lifecycle.hideCase(caseId)
      if (hidden.state !== 'missing') {
        await lifecycle.completeHiddenDeletion(caseId, hidden, {
          batchSize: this.options.batchSize,
          pauseBetweenBatchesMs: this.options.pauseBetweenBatchesMs,
          signal: this.abort.signal,
          onProgress: reportProgress
        })
      }
      const done = registry.update(jobId, {
        status: 'succeeded',
        finishedAt: Date.now(),
        progress: { phase: 'done', done: hidden.variantCount, total: hidden.variantCount }
      })
      if (done !== undefined) this.options.onSettled?.(done, ownerUserId)
    } catch (error) {
      if (error instanceof CaseDeletionInterruptedError) {
        this.options.logger?.info(
          { event: 'case-delete', action: 'interrupted', caseId },
          error.message
        )
        return
      }
      this.options.logger?.error({ event: 'case-delete', action: 'failed', caseId, err: error })
      const failed = registry.update(jobId, {
        status: 'failed',
        finishedAt: Date.now(),
        error: {
          code: error instanceof InvalidParametersError ? 'INVALID_PARAMETERS' : 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error)
        }
      })
      if (failed !== undefined) this.options.onSettled?.(failed, ownerUserId)
    }
  }

  private progressReporter(jobId: string): (progress: CaseDeletionProgress) => void {
    let lastAt = 0
    let lastPhase = ''
    return (progress) => {
      const now = Date.now()
      if (progress.phase === lastPhase && now - lastAt < this.progressIntervalMs) return
      lastAt = now
      lastPhase = progress.phase
      this.options.registry.update(jobId, { progress })
    }
  }
}
