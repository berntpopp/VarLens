import { buildVepFixtureResponse, webParityFixturesEnabled } from '../api-fixture-responses'
import {
  parseVariantCoordArgs,
  runReferenceLookup,
  variantIdentifier
} from '../reference-services/route-helpers'
import { badRequest } from './common'
import type { OverrideHandler } from './types'

/**
 * Ensembl VEP lookups in web mode, behind the admin egress policy
 * (service `vep`, off by default). The parity-fixture mode keeps answering
 * from recorded fixtures without any network access.
 */
export function buildVepOverrides(): Record<string, OverrideHandler> {
  return {
    'vep:fetch': {
      async handle(args, request, reply, deps) {
        const coords = parseVariantCoordArgs(args)
        if (coords === null) {
          return badRequest(reply, 'invalid-vep-fetch', 'Invalid vep.fetch parameters')
        }
        const { chr, pos, ref, alt } = coords
        if (webParityFixturesEnabled()) return buildVepFixtureResponse(chr, pos, ref, alt)
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'vep',
          method: 'vep:fetch',
          identifier: variantIdentifier(chr, pos, ref, alt),
          run: (clients) => clients.vep().fetchVariantAnnotation(chr, pos, ref, alt)
        })
      }
    },

    // The response cache is process-wide and shared across users: per-user
    // stats are not meaningful, and one user must not flush everyone's cache.
    'vep:getCacheStats': {
      handle() {
        return { vepCount: 0, hpoCount: 0, totalBytes: 0 }
      }
    },

    'vep:clearCache': {
      handle() {
        return { success: true }
      }
    },

    // Every web lookup uses its own client, so there is no shared in-flight
    // request to cancel (desktop cancels the previous variant's request).
    'vep:cancel': {
      handle() {
        return { success: true }
      }
    }
  }
}
