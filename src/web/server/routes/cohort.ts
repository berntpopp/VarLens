import {
  CohortCarriersParamsSchema,
  CohortSearchParamsSchema
} from '../../../shared/api/schemas/cohort'
import {
  getCohortVariantsViaSession,
  getCohortColumnMetaViaSession,
  getCohortSummaryViaSession,
  getCohortCarriersViaSession,
  getCohortGeneBurdenViaSession,
  getCohortSummaryStatusViaSession
} from '../../../main/ipc/handlers/cohort-logic'
import { unsupportedWebCapability } from './common'
import type { OverrideHandler } from './types'

export function buildCohortOverrides(): Record<string, OverrideHandler> {
  return {
    'cohort:getVariants': {
      async handle(args, _request, reply, { session }) {
        const [params] = args
        const validated = CohortSearchParamsSchema.safeParse(params)
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-cohort-params', message: 'Invalid cohort search parameters' }
        }

        return await getCohortVariantsViaSession(validated.data, () => session)
      }
    },

    'cohort:getColumnMeta': {
      async handle(_args, _request, _reply, { session }) {
        return await getCohortColumnMetaViaSession(() => session)
      }
    },

    'cohort:getSummary': {
      async handle(_args, _request, _reply, { session }) {
        return await getCohortSummaryViaSession(() => session)
      }
    },

    'cohort:getSummaryStatus': {
      async handle(_args, _request, _reply, { session }) {
        return await getCohortSummaryStatusViaSession(() => session)
      }
    },

    'cohort:runAssociation': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.runAssociation')
      }
    },

    'cohort:cancelAssociation': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.cancelAssociation')
      }
    },

    'cohort:getCarriers': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        const validated = CohortCarriersParamsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-carrier-params', message: 'Invalid carrier query parameters' }
        }

        return await getCohortCarriersViaSession(
          validated.data.chr,
          validated.data.pos,
          validated.data.ref,
          validated.data.alt,
          () => session
        )
      }
    },

    'cohort:getGeneBurden': {
      async handle(_args, _request, _reply, { session }) {
        return await getCohortGeneBurdenViaSession(() => session)
      }
    }
  }
}
