import { z } from 'zod'

import type { StorageWriteTask } from '../../../main/storage/write-executor'
import type { CaseDeleteTarget } from '../../../shared/types/case-delete-job'
import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { CaseNotFoundError } from '../jobs/case-delete-jobs'
import { WEB_EVENT_COHORT_SUMMARY_REBUILT } from '../web-event-types'
import type { DispatcherDeps, OverrideHandler } from './types'

const CaseIdArraySchema = z.array(z.number().int().positive()).min(1).max(10_000)
/** Mirrors the desktop `cases:startDelete` schema (src/main/ipc/handlers/cases.ts). */
const CaseDeleteTargetSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('ids'), ids: CaseIdArraySchema }).strict(),
  z.object({ mode: z.literal('all') }).strict()
])

function badRequest(message: string): SerializableError {
  return { code: ErrorCode.INVALID_PARAMETERS, message, userMessage: 'Invalid case selection.' }
}

function notFound(message: string): SerializableError {
  return { code: ErrorCode.NOT_FOUND, message, userMessage: 'This case no longer exists.' }
}

/** Start the background `case_delete` job and wait for it (blocking variants). */
async function runDeleteJob(
  deps: DispatcherDeps,
  target: CaseDeleteTarget,
  userId: number | undefined
): Promise<number> {
  const handle = deps.jobs!.caseDelete.start(target, userId)
  return (await handle.result).deleted
}

/**
 * Case deletion in web mode runs as the shared `case_delete` job
 * (src/shared/types/case-delete-job.ts) on lock-free Postgres phases:
 *
 *   cases:startDelete(target) → { jobId }  returns immediately; progress via
 *                                         `jobs:changed` SSE, cancel via
 *                                         `jobs:cancel`
 *   cases:delete / deleteBatch / deleteAll  run the same job and wait for it
 *
 * The case disappears from every read as soon as its hide phase commits.
 * Without a job runner (unit tests) `cases:delete` falls back to the write task.
 */
export function buildCasesOverrides(): Record<string, OverrideHandler> {
  return {
    'cases:list': {
      async handle(_args, _request, _reply, { session }) {
        return await session.listCases()
      }
    },

    'cases:startDelete': {
      async handle(args, request, reply, deps) {
        const parsed = CaseDeleteTargetSchema.safeParse(args[0])
        if (!parsed.success) {
          reply.code(400)
          return badRequest('invalid delete target')
        }
        if (deps.jobs === undefined) {
          reply.code(501)
          return badRequest('background case deletion is not available')
        }
        const handle = deps.jobs.caseDelete.start(parsed.data, request.session?.user?.id)
        return { jobId: handle.id }
      }
    },

    'cases:delete': {
      async handle(args, request, reply, deps) {
        const validated = CaseIdSchema.safeParse(args[0])
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case id' }
        }

        const userId = request.session?.user?.id
        if (deps.jobs !== undefined) {
          try {
            await deps.jobs.caseDelete.assertDeletable(validated.data)
          } catch (error) {
            if (!(error instanceof CaseNotFoundError)) throw error
            reply.code(404)
            return notFound(error.message)
          }
          await runDeleteJob(deps, { mode: 'ids', ids: [validated.data] }, userId)
          return undefined
        }

        const result = await deps.session
          .getWriteExecutor()
          .execute({ type: 'cases:delete', params: [validated.data] } as StorageWriteTask)
        if (userId !== undefined) {
          deps.events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
          deps.events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
        }
        return result
      }
    },

    'cases:deleteBatch': {
      async handle(args, request, reply, deps) {
        const parsed = CaseIdArraySchema.safeParse(args[0])
        if (!parsed.success || deps.jobs === undefined) {
          reply.code(parsed.success ? 501 : 400)
          return badRequest('invalid case ids')
        }
        return runDeleteJob(deps, { mode: 'ids', ids: parsed.data }, request.session?.user?.id)
      }
    },

    'cases:deleteAll': {
      async handle(_args, request, reply, deps) {
        if (deps.jobs === undefined) {
          reply.code(501)
          return badRequest('background case deletion is not available')
        }
        return runDeleteJob(deps, { mode: 'all' }, request.session?.user?.id)
      }
    }
  }
}
