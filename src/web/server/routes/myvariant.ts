import {
  parseVariantCoordArgs,
  runReferenceLookup,
  variantIdentifier
} from '../reference-services/route-helpers'
import { badRequest } from './common'
import type { OverrideHandler } from './types'

/** MyVariant.info scores in web mode, behind the egress policy (service `myvariant`). */
export function buildMyVariantOverrides(): Record<string, OverrideHandler> {
  return {
    'myvariant:fetch': {
      async handle(args, request, reply, deps) {
        const coords = parseVariantCoordArgs(args)
        if (coords === null) {
          return badRequest(reply, 'invalid-myvariant-fetch', 'Invalid myvariant.fetch parameters')
        }
        const { chr, pos, ref, alt } = coords
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'myvariant',
          method: 'myvariant:fetch',
          identifier: variantIdentifier(chr, pos, ref, alt),
          run: (clients) => clients.myvariant().fetchVariantScores(chr, pos, ref, alt, 'hg38')
        })
      }
    },

    'myvariant:clearCache': {
      handle() {
        return { success: true }
      }
    }
  }
}
