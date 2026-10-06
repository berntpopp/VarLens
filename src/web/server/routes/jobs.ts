import { z } from 'zod'

import { BACKGROUND_JOB_KINDS } from '../../../shared/types/background-job'
import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import type { OverrideHandler } from './types'

const JobIdSchema = z.string().uuid()
const JobListFilterSchema = z
  .object({
    kind: z.enum(BACKGROUND_JOB_KINDS).optional(),
    activeOnly: z.boolean().optional()
  })
  .strict()
  .optional()

function invalid(message: string): SerializableError {
  return { code: ErrorCode.INVALID_PARAMETERS, message, userMessage: 'Invalid job request.' }
}

/**
 * Poll endpoints for the background-job contract
 * (src/shared/types/background-job.ts):
 *
 *   POST /api/jobs/get   { args: [jobId] }                    → BackgroundJob | 404
 *   POST /api/jobs/list  { args: [{ kind?, activeOnly? }?] }   → BackgroundJob[]
 *
 * Jobs carry only ids, counters and status (no clinical data), and cases are
 * shared across users in this single-tenant release, so any authenticated
 * user may read them. Job polls are excluded from read auditing.
 */
export function buildJobOverrides(): Record<string, OverrideHandler> {
  return {
    'jobs:get': {
      async handle(args, _request, reply, { jobs }) {
        const parsed = JobIdSchema.safeParse(args[0])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job id')
        }
        const job = jobs?.registry.get(parsed.data)
        if (job === undefined) {
          reply.code(404)
          return {
            code: ErrorCode.NOT_FOUND,
            message: jobs === undefined ? 'background jobs are not enabled' : 'job not found',
            userMessage: 'This job is unknown or has expired.'
          } satisfies SerializableError
        }
        return job
      }
    },
    'jobs:list': {
      async handle(args, _request, reply, { jobs }) {
        const parsed = JobListFilterSchema.safeParse(args[0])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job filter')
        }
        return jobs?.registry.list(parsed.data ?? {}) ?? []
      }
    }
  }
}
