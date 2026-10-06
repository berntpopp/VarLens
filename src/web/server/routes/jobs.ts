import {
  JobsCancelParamsSchema,
  JobsGetParamsSchema,
  JobsListParamsSchema,
  JobsProgressParamsSchema
} from '../../../shared/ipc/domains/jobs-schemas'
import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import type { OverrideHandler } from './types'

function invalid(message: string): SerializableError {
  return { code: ErrorCode.INVALID_PARAMETERS, message, userMessage: 'Invalid job request.' }
}

/**
 * Web side of the `jobs:` contract (src/shared/ipc/domains/jobs.ts), served
 * from the web process's own JobRunner:
 *
 *   jobs:list(filter?)  → Job[]
 *   jobs:get(jobId)     → Job | null
 *   jobs:progress(id)   → Job['progress']
 *   jobs:cancel(jobId)  → { requested }
 *
 * `jobs:changed` is pushed over SSE (/api/events) to the user who started
 * the job. Jobs carry ids, counters and status only, and cases are shared
 * across users in this single-tenant release, so any authenticated user may
 * read or cancel them. Status polls are excluded from read auditing; cancel is
 * a write and is audited.
 */
export function buildJobOverrides(): Record<string, OverrideHandler> {
  return {
    'jobs:list': {
      async handle(args, _request, reply, { jobs }) {
        const parsed = JobsListParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job filter')
        }
        return jobs?.runner.list(parsed.data[0]) ?? []
      }
    },
    'jobs:get': {
      async handle(args, _request, reply, { jobs }) {
        const parsed = JobsGetParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job id')
        }
        return jobs?.runner.get(parsed.data[0]) ?? null
      }
    },
    'jobs:progress': {
      async handle(args, _request, reply, { jobs }) {
        const parsed = JobsProgressParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job id')
        }
        return jobs?.runner.get(parsed.data[0])?.progress ?? null
      }
    },
    'jobs:cancel': {
      async handle(args, _request, reply, { jobs }) {
        const parsed = JobsCancelParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job id')
        }
        const job = jobs?.runner.get(parsed.data[0])
        if (job === undefined || (job.status !== 'running' && job.status !== 'queued')) {
          return { requested: false }
        }
        await jobs!.runner.cancel(job.id)
        return { requested: true }
      }
    }
  }
}
