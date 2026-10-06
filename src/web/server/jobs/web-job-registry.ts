/**
 * Multi-user view over the process-wide {@link JobRunner} for web mode.
 *
 * - Ownership: the first lifecycle event of a job is fired synchronously
 *   inside `enqueue()`, i.e. inside the dispatcher's {@link runAsJobActor}
 *   context, so the owner is captured without plumbing a user id through
 *   import/export/delete logic. Jobs started by the server itself (resume of
 *   an interrupted delete at boot) have no owner and are admin-only.
 * - Visibility: a non-admin sees and cancels only their own jobs; admins see
 *   and may cancel all of them (operational control). Cases are shared, jobs
 *   are not: a job's params can name another user's uploads.
 * - Push: every snapshot goes to the owner and to admins as `jobs:changed`
 *   over SSE. Polling (`jobs:list` / `jobs:get`) stays the source of truth.
 */
import { ForbiddenError } from '../../../main/ipc/errors'
import type { JobRunner } from '../../../main/services/jobs/JobRunner'
import { JOBS_CHANNELS } from '../../../shared/ipc/domains/jobs'
import type { Job, JobKind, JobOwner, JobStatus } from '../../../shared/types/jobs'
import type { WebEventHub } from '../events'
import { currentJobActor, isAdminActor, type JobActor } from './job-actor'

export type JobViewer = Pick<JobActor, 'userId' | 'role'>

const ACTIVE: ReadonlySet<JobStatus> = new Set(['queued', 'running'])
/** Param keys never sent to a browser: server paths, secrets, callbacks. */
const HIDDEN_PARAM_KEY = /path|password|secret|token|key$|encryption/i
const MAX_PARAM_ARRAY = 100

function publicParamValue(value: unknown): unknown {
  if (value === null) return null
  if (['string', 'number', 'boolean'].includes(typeof value)) return value
  if (Array.isArray(value)) {
    return value.every((item) => ['string', 'number', 'boolean'].includes(typeof item))
      ? value.slice(0, MAX_PARAM_ARRAY)
      : undefined
  }
  return undefined
}

/**
 * Browser-safe job params: top-level primitives and primitive arrays only
 * (case-delete ids, a case name, an export label). Arrays of objects become a
 * `<key>Count`, so a batch import shows how many files without their paths.
 */
export function publicJobParams(params: unknown): Record<string, unknown> {
  if (params === null || typeof params !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (HIDDEN_PARAM_KEY.test(key) || typeof value === 'function') continue
    const clean = publicParamValue(value)
    if (clean !== undefined) out[key] = clean
    else if (Array.isArray(value)) out[`${key}Count`] = value.length
  }
  return out
}

export class WebJobRegistry {
  private readonly owners = new Map<string, JobOwner | null>()
  private readonly unsubscribe: () => void

  constructor(
    private readonly runner: JobRunner,
    events: Pick<WebEventHub, 'publishToUserAndAdmins'>
  ) {
    this.unsubscribe = runner.onLifecycle((job) => {
      if (!this.owners.has(job.id)) this.owners.set(job.id, ownerFromActor(currentJobActor()))
      const snapshot = this.snapshot(job)
      events.publishToUserAndAdmins(snapshot.owner?.userId, JOBS_CHANNELS.changed, snapshot)
    })
  }

  close(): void {
    this.unsubscribe()
  }

  ownerOf(jobId: string): JobOwner | undefined {
    return this.owners.get(jobId) ?? undefined
  }

  canSee(viewer: JobViewer, job: Pick<Job, 'id'>): boolean {
    return isAdminActor(viewer) || this.ownerOf(job.id)?.userId === viewer.userId
  }

  list(viewer: JobViewer, filter?: { kind?: JobKind; status?: JobStatus }): Job[] {
    return this.runner
      .list(filter)
      .filter((job) => this.canSee(viewer, job))
      .map((job) => this.snapshot(job))
  }

  get(viewer: JobViewer, jobId: string): Job | null {
    const job = this.runner.get(jobId)
    return job !== undefined && this.canSee(viewer, job) ? this.snapshot(job) : null
  }

  /**
   * Cancel one job. Unknown or finished jobs are a no-op; somebody else's
   * running job is a {@link ForbiddenError} (403) unless the viewer is admin.
   */
  async cancel(viewer: JobViewer, jobId: string): Promise<{ requested: boolean }> {
    const job = this.runner.get(jobId)
    if (job === undefined || !ACTIVE.has(job.status)) return { requested: false }
    this.assertMayCancel(viewer, job)
    await this.runner.cancel(job.id)
    return { requested: true }
  }

  /**
   * Cancel the viewer's active jobs of the given kinds — the legacy
   * `import:cancel` / `batch-import:cancel` calls, which carry no job id.
   * Imports are single-flight per process, so an active import owned by
   * someone else means this caller has nothing of theirs to cancel: that is
   * a 403, never a silent cancel of another user's run.
   */
  async cancelActive(viewer: JobViewer, kinds: readonly JobKind[]): Promise<number> {
    const active = this.runner
      .list()
      .filter((job) => kinds.includes(job.kind) && ACTIVE.has(job.status))
    for (const job of active) this.assertMayCancel(viewer, job)
    for (const job of active) await this.runner.cancel(job.id)
    return active.length
  }

  private assertMayCancel(viewer: JobViewer, job: Job): void {
    if (isAdminActor(viewer) || this.ownerOf(job.id)?.userId === viewer.userId) return
    throw new ForbiddenError(
      `user ${viewer.userId} may not cancel job ${job.id}`,
      'This job was started by another user and cannot be cancelled by you.'
    )
  }

  private snapshot(job: Job): Job {
    const owner = this.ownerOf(job.id)
    return {
      ...job,
      params: publicJobParams(job.params),
      progress: job.progress && { ...job.progress },
      ...(owner !== undefined ? { owner } : {})
    }
  }
}

function ownerFromActor(actor: JobActor | undefined): JobOwner | null {
  return actor === undefined ? null : { userId: actor.userId, username: actor.username }
}
