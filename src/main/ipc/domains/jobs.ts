import { ipcMain } from 'electron'
import { JOBS_CHANNELS } from '../../../shared/ipc/domains/jobs'
import {
  JobsCancelParamsSchema,
  JobsGetParamsSchema,
  JobsListParamsSchema,
  JobsProgressParamsSchema
} from '../../../shared/ipc/domains/jobs-schemas'
import { jobRunner } from '../../services/jobs/runner'
import type { Job } from '../../../shared/types/jobs'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'
import { safeEmit } from '../utils/safeEmit'

let unsubscribeLifecycle: (() => void) | null = null

/**
 * Structured-clone-safe copy of a job. Some job kinds carry callbacks in
 * their params (import progress hooks); those params are dropped rather than
 * failing the IPC send.
 */
function toJobSnapshot(job: Job): Job {
  return {
    ...job,
    params: cloneableOrNull(job.params),
    progress: job.progress && { ...job.progress }
  }
}

function cloneableOrNull(value: unknown): unknown {
  try {
    return structuredClone(value)
  } catch {
    return null
  }
}

/**
 * Registers the `jobs:` channels against the process-wide {@link jobRunner}
 * and forwards every lifecycle/progress transition to the renderer as a
 * `jobs:changed` event (a plain snapshot — params included, since job params
 * are already renderer-supplied data).
 *
 * Job ids are in-memory JobRunner Map keys (not filesystem paths), but every
 * IPC arg is still validated at the boundary per repo convention.
 */
export function registerJobsHandlers(): void {
  unsubscribeLifecycle?.()
  unsubscribeLifecycle = jobRunner.onLifecycle((job) => {
    safeEmit(JOBS_CHANNELS.changed, toJobSnapshot(job))
  })

  ipcMain.handle(JOBS_CHANNELS.cancel, async (_event, jobId?: unknown) =>
    wrapHandler(async () => {
      const parsed = JobsCancelParamsSchema.safeParse([jobId])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid ${JOBS_CHANNELS.cancel} params: ${parsed.error.message}`
        )
      }
      const [validatedJobId] = parsed.data
      const job = jobRunner.get(validatedJobId)
      if (job === undefined || (job.status !== 'running' && job.status !== 'queued')) {
        return { requested: false }
      }
      await jobRunner.cancel(validatedJobId)
      return { requested: true }
    })
  )

  ipcMain.handle(JOBS_CHANNELS.list, async (_event, filter?: unknown) =>
    wrapHandler(async () => {
      const parsed = JobsListParamsSchema.safeParse([filter])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid ${JOBS_CHANNELS.list} params: ${parsed.error.message}`
        )
      }
      const [validatedFilter] = parsed.data
      return jobRunner.list(validatedFilter)
    })
  )

  ipcMain.handle(JOBS_CHANNELS.get, async (_event, jobId?: unknown) =>
    wrapHandler(async () => {
      const parsed = JobsGetParamsSchema.safeParse([jobId])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid ${JOBS_CHANNELS.get} params: ${parsed.error.message}`
        )
      }
      const [validatedJobId] = parsed.data
      return jobRunner.get(validatedJobId) ?? null
    })
  )

  ipcMain.handle(JOBS_CHANNELS.progress, async (_event, jobId?: unknown) =>
    wrapHandler(async () => {
      const parsed = JobsProgressParamsSchema.safeParse([jobId])
      if (!parsed.success) {
        throw new InvalidParametersError(
          `Invalid ${JOBS_CHANNELS.progress} params: ${parsed.error.message}`
        )
      }
      const [validatedJobId] = parsed.data
      return jobRunner.get(validatedJobId)?.progress ?? null
    })
  )
}
