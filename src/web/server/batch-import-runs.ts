/**
 * Batch imports started over HTTP, tracked from accept to result.
 *
 * `batch-import:start` does not hold its request open for the batch (a proxy
 * or load-balancer timeout would cut it, and a browser reload would lose the
 * result). It enqueues the job, registers the run here and answers at once
 * with the job id. The result then travels three ways:
 *
 *   - `batch-import:complete` (existing event) carries it on success
 *   - `batch-import:failed` carries the error when the job rejects
 *   - `batch-import:status` returns either for the run id, for a client that
 *     reconnects, reloads, or missed the event
 *
 * Runs are kept in memory, as the jobs themselves are: after a server restart
 * a run is `unknown` and the interrupted import is cleaned up by the import
 * recovery. Settled runs are kept long enough for a client to come back.
 */
import type { BatchResult } from '../../shared/types/api'
import type { SerializableError } from '../../shared/types/errors'

export type BatchImportRunStatus =
  | { state: 'running'; jobId: string }
  | { state: 'completed'; jobId: string; result: BatchResult }
  | { state: 'failed'; jobId: string; error: SerializableError }
  | { state: 'unknown' }

/** What `batch-import:start` answers with. */
export interface BatchImportAccepted {
  accepted: true
  jobId: string
  runId: string
}

interface TrackedRun {
  userId: number
  runId: string
  status: Exclude<BatchImportRunStatus, { state: 'unknown' }>
  settledAt: number | null
}

/** A settled run stays readable this long. */
export const SETTLED_RUN_TTL_MS = 60 * 60 * 1000
/** Upper bound on tracked runs; the oldest settled ones go first. */
export const MAX_TRACKED_RUNS = 200

const runKey = (userId: number, runId: string): string => `${userId}\u0000${runId}`

export class BatchImportRuns {
  private readonly runs = new Map<string, TrackedRun>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * True while this user has a tracked run with that id. Run ids are scoped
   * to their user: another user's id is neither visible nor "in use", so no
   * answer of the server reveals that it exists.
   */
  has(runId: string, userId: number): boolean {
    this.prune()
    return this.runs.has(runKey(userId, runId))
  }

  start(runId: string, userId: number, jobId: string): void {
    this.prune()
    this.runs.set(runKey(userId, runId), {
      userId,
      runId,
      status: { state: 'running', jobId },
      settledAt: null
    })
  }

  complete(runId: string, userId: number, result: BatchResult): void {
    this.settle(runKey(userId, runId), (jobId) => ({ state: 'completed', jobId, result }))
  }

  fail(runId: string, userId: number, error: SerializableError): void {
    this.settle(runKey(userId, runId), (jobId) => ({ state: 'failed', jobId, error }))
  }

  /**
   * The run as its owner may see it. Somebody else's run and an unknown run
   * look the same, so a run id cannot be probed. An admin without a run of
   * that id sees the one of whoever has it.
   */
  status(runId: string, viewer: { userId: number; isAdmin: boolean }): BatchImportRunStatus {
    this.prune()
    const own = this.runs.get(runKey(viewer.userId, runId))
    if (own !== undefined) return own.status
    if (!viewer.isAdmin) return { state: 'unknown' }
    for (const run of this.runs.values()) {
      if (run.runId === runId) return run.status
    }
    return { state: 'unknown' }
  }

  private settle(
    key: string,
    next: (jobId: string) => Exclude<BatchImportRunStatus, { state: 'unknown' | 'running' }>
  ): void {
    const run = this.runs.get(key)
    if (run === undefined) return
    run.status = next(run.status.jobId)
    run.settledAt = this.now()
  }

  private prune(): void {
    const cutoff = this.now() - SETTLED_RUN_TTL_MS
    for (const [key, run] of this.runs) {
      if (run.settledAt !== null && run.settledAt < cutoff) this.runs.delete(key)
    }
    if (this.runs.size <= MAX_TRACKED_RUNS) return
    const settled = [...this.runs.entries()]
      .filter(([, run]) => run.settledAt !== null)
      .sort((a, b) => (a[1].settledAt ?? 0) - (b[1].settledAt ?? 0))
    for (const [key] of settled) {
      if (this.runs.size <= MAX_TRACKED_RUNS) break
      this.runs.delete(key)
    }
  }
}

/** Process-wide, like the JobRunner the runs execute on. */
export const batchImportRuns = new BatchImportRuns()
