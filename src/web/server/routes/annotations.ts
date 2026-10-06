import {
  CaseVariantIdSchema,
  GlobalAnnotationUpdatesSchema,
  PerCaseAnnotationUpdatesSchema,
  VariantCoordsSchema
} from '../../../shared/api/schemas/annotations'
import {
  upsertGlobalAnnotationViaSession,
  upsertPerCaseAnnotationWithEvent
} from '../../../main/ipc/handlers/annotations-logic'
import { WEB_EVENT_VARIANTS_ANNOTATION_CHANGED } from '../web-event-types'
import type { OverrideHandler } from './types'

export function buildAnnotationOverrides(): Record<string, OverrideHandler> {
  return {
    'annotations:getGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-annotation-coordinates' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getGlobal',
          params: [validated.data]
        })
      }
    },

    // Spec P-22: the write autoroute passed (chr, pos, ref, alt) straight
    // through, but the executor task takes one VariantCoords object. Pack and
    // validate the coordinates like the desktop handler does.
    'annotations:deleteGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt] = args
        const validated = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validated.success) {
          reply.code(400)
          return { error: 'invalid-annotation-coordinates' }
        }
        await session.getWriteExecutor().execute({
          type: 'annotations:deleteGlobal',
          params: [validated.data]
        })
        return undefined
      }
    },

    'annotations:upsertGlobal': {
      async handle(args, _request, reply, { session }) {
        const [chr, pos, ref, alt, updates] = args
        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        const validatedUpdates = GlobalAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedCoords.success || !validatedUpdates.success) {
          reply.code(400)
          return { error: 'invalid-annotation-upsert' }
        }
        return await upsertGlobalAnnotationViaSession(
          validatedCoords.data,
          validatedUpdates.data,
          () => session
        )
      }
    },

    'annotations:upsertPerCase': {
      async handle(args, request, reply, { session, events }) {
        const [caseId, variantId, updates] = args
        const validatedIds = CaseVariantIdSchema.safeParse({ caseId, variantId })
        const validatedUpdates = PerCaseAnnotationUpdatesSchema.safeParse(updates)
        if (!validatedIds.success || !validatedUpdates.success) {
          reply.code(400)
          return { error: 'invalid-per-case-annotation-upsert' }
        }
        return await upsertPerCaseAnnotationWithEvent(
          validatedIds.data.caseId,
          validatedIds.data.variantId,
          validatedUpdates.data,
          () => session,
          (e) => {
            const userId = request.session?.user?.id
            if (userId !== undefined) {
              events.publish(userId, WEB_EVENT_VARIANTS_ANNOTATION_CHANGED, e)
            }
          }
        )
      }
    },

    'annotations:getForVariant': {
      async handle(args, _request, reply, { session }) {
        const [caseId, chr, pos, ref, alt] = args
        const validatedIds = CaseVariantIdSchema.shape.caseId.safeParse(caseId)
        const validatedCoords = VariantCoordsSchema.safeParse({ chr, pos, ref, alt })
        if (!validatedIds.success || !validatedCoords.success) {
          reply.code(400)
          return { error: 'invalid-annotation-query' }
        }
        return await session.getReadExecutor().execute({
          type: 'annotations:getForVariant',
          params: [validatedIds.data, validatedCoords.data]
        })
      }
    }
  }
}
