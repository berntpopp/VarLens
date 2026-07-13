import { ipcMain } from 'electron'
import { JOBS_CHANNELS } from '../../../shared/ipc/domains/jobs'
import {
  JobsGetParamsSchema,
  JobsListParamsSchema,
  JobsProgressParamsSchema
} from '../../../shared/ipc/domains/jobs-schemas'
import { jobRunner } from '../../services/jobs/runner'
import { wrapHandler } from '../errorHandler'
import { InvalidParametersError } from '../errors'

/**
 * Registers the read-only `jobs:` channels against the process-wide
 * {@link jobRunner}. No renderer consumes these in PR-4; the contract exists so
 * Sprint D's jobs drawer can wire up without further IPC plumbing.
 *
 * Job ids are in-memory JobRunner Map keys (not filesystem paths), but every
 * IPC arg is still validated at the boundary per repo convention.
 */
export function registerJobsHandlers(): void {
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
