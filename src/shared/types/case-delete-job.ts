/**
 * Backend-neutral contract for the background case-delete job.
 *
 * Desktop (SQLite) runs the job in `src/main/workers/delete-worker.ts`; the
 * web/Postgres backend runs its own job. Both report through the generic
 * `Job` record (`src/shared/types/jobs.ts`, kind `case_delete`):
 *
 * - `Job.params`            → {@link CaseDeleteTarget}
 * - `Job.progress.current`  → cases deleted so far
 * - `Job.progress.total`    → cases targeted
 * - `Job.progress.message`  → a {@link CaseDeletePhase}
 * - terminal `Job.status`   → `completed` | `failed` | `cancelled`
 *
 * Renderers subscribe to `jobs:changed` (desktop IPC event; web SSE) and may
 * cancel with `jobs:cancel(jobId)`. Cancellation is cooperative and lands
 * between cases: every case that was deleted is deleted completely
 * (variants, annotations and internal-frequency contribution together).
 */

export type CaseDeleteTarget = { mode: 'ids'; ids: number[] } | { mode: 'all' }

export type CaseDeletePhase =
  'deleting' | 'rebuilding-search-index' | 'rebuilding-cohort-summary' | 'finalizing'

export const CASE_DELETE_PHASES: readonly CaseDeletePhase[] = [
  'deleting',
  'rebuilding-search-index',
  'rebuilding-cohort-summary',
  'finalizing'
]

export interface CaseDeleteProgress {
  phase: CaseDeletePhase
  current: number
  total: number
}

export interface CaseDeleteJobResult {
  deleted: number
  cancelled: boolean
}

/** Returned by `cases:startDelete` — the job keeps running after the call returns. */
export interface CaseDeleteJobHandle {
  jobId: string
}
