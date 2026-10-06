import { z } from 'zod'

import { runReferenceLookup } from '../reference-services/route-helpers'
import { badRequest } from './common'
import type { OverrideHandler } from './types'

/** Same bounds as the desktop gnomAD handlers (src/main/ipc/handlers/gnomad.ts). */
const GnomadArgsSchema = z.object({
  gene: z.string().min(1).max(50),
  dataset: z.enum(['gnomad_r4', 'gnomad_r3', 'gnomad_r2_1']).optional()
})

function parseGnomadArgs(args: unknown[]): z.infer<typeof GnomadArgsSchema> | null {
  // JSON turns an omitted dataset into null; treat it as absent.
  const parsed = GnomadArgsSchema.safeParse({ gene: args[0], dataset: args[1] ?? undefined })
  return parsed.success ? parsed.data : null
}

/**
 * gnomAD population variants and gnomAD-hosted ClinVar variants (lollipop
 * plot) in web mode, behind the egress policy (service `gnomad`, off by
 * default). Previously `gnomad:*` had no web route at all (404).
 */
export function buildGnomadOverrides(): Record<string, OverrideHandler> {
  return {
    'gnomad:getVariants': {
      async handle(args, request, reply, deps) {
        const parsed = parseGnomadArgs(args)
        if (parsed === null) {
          return badRequest(reply, 'invalid-gnomad-args', 'Invalid gnomad.getVariants parameters')
        }
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'gnomad',
          method: 'gnomad:getVariants',
          identifier: parsed.gene,
          run: (clients) => clients.gnomad().fetchGeneVariants(parsed.gene, parsed.dataset)
        })
      }
    },

    'gnomad:getClinVarVariants': {
      async handle(args, request, reply, deps) {
        const parsed = parseGnomadArgs(args)
        if (parsed === null) {
          return badRequest(
            reply,
            'invalid-gnomad-args',
            'Invalid gnomad.getClinVarVariants parameters'
          )
        }
        return await runReferenceLookup({
          deps,
          request,
          reply,
          service: 'gnomad',
          method: 'gnomad:getClinVarVariants',
          identifier: parsed.gene,
          run: (clients) => clients.gnomad().fetchClinVarVariants(parsed.gene, parsed.dataset)
        })
      }
    }
  }
}
