import type { SerializableError } from './errors'

/**
 * Cross-process job shape. Lives in `src/shared/` so both the main process
 * (JobRunner) and the renderer (via the `jobs:` IPC contract) can reference it
 * without the renderer importing from `src/main/…` — the two processes do not
 * share a runtime, so the type must live on the shared layer.
 *
 * `src/main/services/jobs/types.ts` re-exports these names for main-side call
 * sites that predate this split.
 */

export type JobKind =
  'import_single' | 'import_batch' | 'cohort_rebuild' | 'association' | 'export' | 'case_delete'

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface Job<P = unknown> {
  id: string // ULID, chronologically sortable
  kind: JobKind
  status: JobStatus
  params: P
  progress: { current: number; total: number; message?: string } | null
  error: SerializableError | null
  createdAt: number // epoch ms
  startedAt: number | null
  finishedAt: number | null
  /**
   * Who started the job. Set by the web server (multi-user); absent on
   * desktop, where every job belongs to the single local user. Non-admin web
   * users only ever see their own jobs, so this matters for admin views.
   */
  owner?: JobOwner
}

export interface JobOwner {
  userId: number
  username: string
}
