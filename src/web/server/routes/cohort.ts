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
import { AssociationConfigSchema } from '../../../shared/types/ipc-schemas'
import { runAssociationInProcess } from '../../../main/ipc/handlers/association-logic'
import { AssociationBusyError } from '../association/web-association-runs'
import { badRequest, unsupportedWebCapability } from './common'
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

    'cohort:rebuildSummary': {
      handle(_args, _request, reply) {
        return unsupportedWebCapability(reply, 'cohort.rebuildSummary')
      }
    },

    // Gene-burden association on Postgres: same contingency builder, tests
    // and FDR as desktop, run in-process per user (src/web/server/association/).
    'cohort:runAssociation': {
      async handle(args, request, reply, deps) {
        const runs = deps.association
        const userId = request.session?.user?.id
        if (runs === undefined || userId === undefined) {
          return unsupportedWebCapability(reply, 'cohort.runAssociation')
        }
        const parsed = AssociationConfigSchema.safeParse(args[0])
        if (!parsed.success) {
          return badRequest(reply, 'invalid-association-config', 'Invalid association parameters')
        }
        try {
          return await runs.run(userId, (ctx) =>
            runAssociationInProcess(parsed.data, ctx.buildData, {
              signal: ctx.signal,
              onProgress: ctx.onProgress
            })
          )
        } catch (error) {
          if (error instanceof AssociationBusyError) {
            reply.code(409)
            return { error: 'association-running', message: error.message }
          }
          if (error instanceof Error && error.message.startsWith('Groups overlap')) {
            return badRequest(reply, 'association-groups-overlap', error.message)
          }
          throw error
        }
      }
    },

    // Cancels only the caller's own run; resolves like desktop (void).
    'cohort:cancelAssociation': {
      handle(_args, request, reply, deps) {
        const userId = request.session?.user?.id
        if (deps.association === undefined || userId === undefined) {
          return unsupportedWebCapability(reply, 'cohort.cancelAssociation')
        }
        deps.association.cancel(userId)
        return null
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
