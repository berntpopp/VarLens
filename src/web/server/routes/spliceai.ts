import {
  parseVariantCoordArgs,
  runReferenceLookup,
  variantIdentifier
} from '../reference-services/route-helpers'
import { badRequest } from './common'
import type { OverrideHandler } from './types'

/** SpliceAI delta scores in web mode, behind the egress policy (service `spliceai`). */
export function buildSpliceAiOverrides(): Record<string, OverrideHandler> {
  return {
    'spliceai:fetch': {
      async handle(args, request, reply, deps) {
        const coords = parseVariantCoordArgs(args)
        if (coords === null) {
          return badRequest(reply, 'invalid-spliceai-fetch', 'Invalid spliceai.fetch parameters')
        }
        const { chr, pos, ref, alt } = coords
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'spliceai',
          method: 'spliceai:fetch',
          identifier: variantIdentifier(chr, pos, ref, alt),
          run: (clients) => clients.spliceai().fetchSpliceAIScores(chr, pos, ref, alt, '38')
        })
      }
    },

    'spliceai:clearCache': {
      handle() {
        return { success: true }
      }
    }
  }
}
