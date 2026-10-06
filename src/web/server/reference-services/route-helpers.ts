import type { FastifyReply, FastifyRequest } from 'fastify'

import type { ReferenceServiceId } from '../../../shared/ipc/domains/reference-services'
import { VariantCoordsSchema } from '../../../shared/types/ipc-schemas'
import { unsupportedWebCapability } from '../routes/common'
import type { DispatcherDeps } from '../routes/types'
import { ExternalLookupDisabledError, type ReferenceClients } from './reference-services'

export interface ExternalLookupDisabledBody {
  error: 'external-lookup-disabled'
  service: ReferenceServiceId
  message: string
}

/**
 * Run one external lookup for a dispatcher override: policy check and audit
 * first (WebReferenceServices.lookup), then the client call.
 *
 * A disabled service answers 403 with the user-facing reason as `message`;
 * the dispatcher turns that into a SerializableError whose `userMessage` is
 * that reason. No client method runs, so no request leaves the server.
 */
export async function runReferenceLookup<T>(params: {
  deps: DispatcherDeps
  request: FastifyRequest
  reply: FastifyReply
  service: ReferenceServiceId
  method: string
  identifier: string
  run: (clients: ReferenceClients) => Promise<T>
}): Promise<T | ExternalLookupDisabledBody | ReturnType<typeof unsupportedWebCapability>> {
  const services = params.deps.referenceServices
  if (services === undefined) return unsupportedWebCapability(params.reply, params.method)
  try {
    return await services.lookup(
      params.service,
      {
        username: params.request.session?.user?.username ?? null,
        method: params.method,
        identifier: params.identifier
      },
      params.run
    )
  } catch (error) {
    if (!(error instanceof ExternalLookupDisabledError)) throw error
    params.reply.code(403)
    return { error: 'external-lookup-disabled', service: error.service, message: error.reason }
  }
}

/** Identifier for variant-level lookups as written to the audit trail. */
export function variantIdentifier(chr: string, pos: number, ref: string, alt: string): string {
  return `${chr}:${pos}:${ref}>${alt}`
}

/** Desktop `VariantCoordsSchema` bounds for `(chr, pos, ref, alt)` positional args. */
export function parseVariantCoordArgs(
  args: unknown[]
): { chr: string; pos: number; ref: string; alt: string } | null {
  const parsed = VariantCoordsSchema.safeParse({
    chr: args[0],
    pos: args[1],
    ref: args[2],
    alt: args[3]
  })
  return parsed.success ? parsed.data : null
}
