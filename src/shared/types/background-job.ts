/**
 * Backend-neutral contract for long-running operations that must not block
 * the request (web) or the main thread (desktop): case deletion today, and
 * the natural home for import/export/rebuild jobs later.
 *
 * Lifecycle: `queued` → `running` → `succeeded` | `failed`. A job is created
 * by the operation's start call (e.g. web `cases:delete` returns the job),
 * reported through `jobs:get` / `jobs:list` (poll) and, in web mode, the
 * `job:updated` SSE event. Terminal jobs are retained for a bounded time so
 * a client that polls late still sees the outcome.
 *
 * The contract carries no backend specifics: `progress.phase` is a free-form
 * step label owned by the job kind, `done`/`total` are unit-less counters
 * (rows for case deletion), and `subject` names the entity the job acts on.
 */

export const BACKGROUND_JOB_KINDS = ['case-delete'] as const
export type BackgroundJobKind = (typeof BACKGROUND_JOB_KINDS)[number]

export const BACKGROUND_JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number]

export interface BackgroundJobSubject {
  type: 'case'
  id: number
}

export interface BackgroundJobProgress {
  /** Kind-specific step label, e.g. 'hiding' | 'purging' | 'finalizing'. */
  phase: string
  done: number
  /** Null when the total is unknown up front. */
  total: number | null
}

export interface BackgroundJobError {
  code: string
  message: string
}

export interface BackgroundJob {
  id: string
  kind: BackgroundJobKind
  status: BackgroundJobStatus
  subject: BackgroundJobSubject
  progress: BackgroundJobProgress
  error?: BackgroundJobError
  /** Epoch ms. */
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

export function isTerminalJobStatus(status: BackgroundJobStatus): boolean {
  return status === 'succeeded' || status === 'failed'
}

/** SSE event name carrying a `BackgroundJob` payload (web mode). */
export const BACKGROUND_JOB_UPDATED_EVENT = 'job:updated'
