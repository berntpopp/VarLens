import type { StorageWriteTask } from '../../../main/storage/write-executor'
import { ErrorCode, type SerializableError } from '../../../shared/types/errors'
import { CaseIdSchema } from '../../../shared/types/ipc-schemas'
import { CaseNotFoundError } from '../jobs/case-delete-jobs'
import { WEB_EVENT_COHORT_SUMMARY_REBUILT } from '../web-event-types'
import type { OverrideHandler } from './types'

export function buildCasesOverrides(): Record<string, OverrideHandler> {
  return {
    'cases:list': {
      async handle(_args, _request, _reply, { session }) {
        return await session.listCases()
      }
    },

    /**
     * Web mode: deletion is a background job. The request validates the case,
     * queues the job and returns the `BackgroundJob` immediately; poll
     * `jobs:get` (or listen for the `job:updated` SSE event) for completion.
     * The case disappears from every read as soon as the job's hide phase
     * commits. Without a job runner (unit tests) the synchronous write task
     * runs instead.
     */
    'cases:delete': {
      async handle(args, request, reply, { session, events, jobs }) {
        const [caseId] = args
        const validated = CaseIdSchema.safeParse(caseId)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-case-id', message: 'Invalid case id' }
        }

        const userId = request.session?.user?.id
        if (jobs !== undefined) {
          try {
            return await jobs.caseDelete.start(validated.data, userId)
          } catch (error) {
            if (error instanceof CaseNotFoundError) {
              reply.code(404)
              return {
                code: ErrorCode.NOT_FOUND,
                message: error.message,
                userMessage: 'This case no longer exists.'
              } satisfies SerializableError
            }
            throw error
          }
        }

        const result = await session
          .getWriteExecutor()
          .execute({ type: 'cases:delete', params: [validated.data] } as StorageWriteTask)
        if (userId !== undefined) {
          events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: true })
          events.publish(userId, WEB_EVENT_COHORT_SUMMARY_REBUILT, { is_stale: false })
        }
        return result
      }
    }
  }
}
