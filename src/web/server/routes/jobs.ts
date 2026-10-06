import type { FastifyRequest } from 'fastify'

import {
  JobsCancelParamsSchema,
  JobsGetParamsSchema,
  JobsListParamsSchema,
  JobsProgressParamsSchema
} from '../../../shared/ipc/domains/jobs-schemas'
import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import type { JobViewer } from '../jobs/web-job-registry'
import type { OverrideHandler } from './types'

function invalid(message: string): SerializableError {
  return { code: ErrorCode.VALIDATION, message, userMessage: 'Invalid job request.' }
}

/** The dispatcher only reaches these handlers with an authenticated session. */
export function jobViewerOf(request: FastifyRequest): JobViewer {
  const user = request.session?.user
  return { userId: user?.id ?? -1, role: user?.role ?? 'user' }
}

/**
 * Web side of the `jobs:` contract (src/shared/ipc/domains/jobs.ts), served
 * by the {@link WebJobRegistry} over the process-wide JobRunner:
 *
 *   jobs:list(filter?)  → Job[]          own jobs; admins: all jobs
 *   jobs:get(jobId)     → Job | null     null for unknown AND for other users' jobs
 *   jobs:progress(id)   → Job['progress']
 *   jobs:cancel(jobId)  → { requested }  403 FORBIDDEN for another user's job
 *                                        (admins may cancel any job)
 *
 * Snapshots carry `owner` and browser-safe params (no server paths).
 * `jobs:changed` is pushed over SSE to the owner and to admins. Status polls
 * are excluded from read auditing; cancel is a write and is audited.
 */
export function buildJobOverrides(): Record<string, OverrideHandler> {
  return {
    'jobs:list': {
      async handle(args, request, reply, { jobs }) {
        const parsed = JobsListParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job filter')
        }
        return jobs?.registry.list(jobViewerOf(request), parsed.data[0]) ?? []
      }
    },
    'jobs:get': {
      async handle(args, request, reply, { jobs }) {
        const parsed = JobsGetParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job id')
        }
        return jobs?.registry.get(jobViewerOf(request), parsed.data[0]) ?? null
      }
    },
    'jobs:progress': {
      async handle(args, request, reply, { jobs }) {
        const parsed = JobsProgressParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job id')
        }
        return jobs?.registry.get(jobViewerOf(request), parsed.data[0])?.progress ?? null
      }
    },
    'jobs:cancel': {
      async handle(args, request, reply, { jobs }) {
        const parsed = JobsCancelParamsSchema.safeParse([args[0]])
        if (!parsed.success) {
          reply.code(400)
          return invalid('invalid job id')
        }
        if (jobs === undefined) return { requested: false }
        // ForbiddenError → 403 via the dispatcher's error-code status map.
        return await jobs.registry.cancel(jobViewerOf(request), parsed.data[0])
      }
    }
  }
}
