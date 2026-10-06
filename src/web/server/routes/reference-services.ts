import { z } from 'zod'

import {
  REFERENCE_SERVICE_IDS,
  type ReferenceServiceId
} from '../../../shared/ipc/domains/reference-services'
import { badRequest, unsupportedWebCapability } from './common'
import { requireAdmin } from './guards'
import { recordPolicyChangeAudit } from '../reference-services/audit-sink'
import type { OverrideHandler } from './types'

const PolicyUpdateSchema = z
  .object(
    Object.fromEntries(REFERENCE_SERVICE_IDS.map((id) => [id, z.boolean().optional()])) as Record<
      ReferenceServiceId,
      z.ZodOptional<z.ZodBoolean>
    >
  )
  .strict()

/**
 * External-lookup egress policy (instance setting, persisted in Postgres).
 * `status` is readable by every signed-in user so the UI can show why a
 * lookup is unavailable; `setPolicy` is admin-only and audited.
 */
export function buildReferenceServicesOverrides(): Record<string, OverrideHandler> {
  return {
    'reference-services:status': {
      async handle(_args, _request, reply, deps) {
        if (deps.referenceServices === undefined) {
          return unsupportedWebCapability(reply, 'referenceServices.status')
        }
        return await deps.referenceServices.status()
      }
    },

    'reference-services:setPolicy': {
      async handle(args, request, reply, deps) {
        const admin = requireAdmin(request, reply)
        if (admin === undefined) {
          return {
            error: 'forbidden',
            message: 'Only administrators can change external lookup settings.'
          }
        }
        if (deps.referenceServices === undefined) {
          return unsupportedWebCapability(reply, 'referenceServices.setPolicy')
        }
        const parsed = PolicyUpdateSchema.safeParse(args[0])
        if (!parsed.success) {
          return badRequest(
            reply,
            'invalid-reference-services-policy',
            'Policy update must map known service ids to true/false.'
          )
        }
        const status = await deps.referenceServices.setPolicy(parsed.data, admin.username)
        await recordPolicyChangeAudit(deps.session, admin.username, parsed.data)
        return status
      }
    }
  }
}
