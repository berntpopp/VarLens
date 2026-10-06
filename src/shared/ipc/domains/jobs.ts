import type { IpcResult } from '../../types/errors'
import type { Job, JobKind, JobStatus } from '../../types/jobs'

/**
 * `jobs:` IPC surface over the process-wide {@link Job} tracker. Besides the
 * read channels it carries the generic background-job controls: a push event
 * (`jobs:changed`, fired on every lifecycle transition and progress report)
 * and cooperative cancellation (`jobs:cancel`). Background case deletion
 * (`case_delete`, see src/shared/types/case-delete-job.ts) is the first
 * consumer; the contract is backend-neutral so web mode can emit the same
 * snapshots over SSE.
 */
export interface JobsApi {
  /** `jobs:list` — all tracked jobs, optionally filtered by kind/status. */
  list: (filter?: { kind?: JobKind; status?: JobStatus }) => Promise<IpcResult<Job[]>>
  /** `jobs:get` — a single tracked job by id, or null when unknown. */
  get: (jobId: string) => Promise<IpcResult<Job | null>>
  /** `jobs:progress` — the current progress snapshot for a job (null if none). */
  progress: (jobId: string) => Promise<IpcResult<Job['progress']>>
  /** `jobs:cancel` — request cooperative cancellation; resolves once requested. */
  cancel: (jobId: string) => Promise<IpcResult<{ requested: boolean }>>
  /** Subscribe to `jobs:changed` job snapshots. Returns an unsubscribe function. */
  onChanged: (callback: (job: Job) => void) => () => void
}

export const JOBS_CHANNELS = {
  list: 'jobs:list',
  get: 'jobs:get',
  progress: 'jobs:progress',
  cancel: 'jobs:cancel',
  changed: 'jobs:changed'
} as const
