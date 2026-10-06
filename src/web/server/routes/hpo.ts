import { z } from 'zod'

import { buildHpoFixtureResponse, webParityFixturesEnabled } from '../api-fixture-responses'
import { HpoSearchArgsSchema } from '../../../shared/api/schemas/hpo'
import type { HpoSearchResult } from '../../../shared/types/api-enrichment'
import { searchHpoTerms } from '../../../shared/utils/hpo-term-search'
import { loadWebHpoTerms } from '../web-hpo-terms'
import { badRequest } from './common'
import type { OverrideHandler } from './types'

/** Same bounds as the desktop `hpo:search` handler (src/main/ipc/handlers/hpo.ts). */
const HpoSearchParamsSchema = z.object({
  query: z.string().min(1).max(500),
  maxResults: z.number().int().positive().max(100).optional()
})

/**
 * HPO term search for web mode, served from the bundled ontology term list
 * (src/web/server/web-hpo-terms.ts): no outbound request, so it is not subject
 * to the external-lookup egress policy. The parity-fixture mode keeps answering
 * from the recorded desktop fixtures so the desktop/web parity scenarios stay
 * comparable.
 */
export function buildHpoOverrides(): Record<string, OverrideHandler> {
  return {
    'hpo:search': {
      handle(args, _request, reply): HpoSearchResult | ReturnType<typeof badRequest> {
        const tuple = HpoSearchArgsSchema.safeParse(args)
        const parsed = tuple.success
          ? HpoSearchParamsSchema.safeParse({
              query: tuple.data[0],
              maxResults: tuple.data[1] ?? undefined
            })
          : null
        if (parsed === null || !parsed.success) {
          return badRequest(
            reply,
            'invalid-hpo-search',
            'hpo.search query must be a 1-500 character string; maxResults 1-100'
          )
        }
        const { query, maxResults } = parsed.data
        if (webParityFixturesEnabled()) return buildHpoFixtureResponse(query, maxResults)
        return { success: true, terms: searchHpoTerms(loadWebHpoTerms(), query, maxResults) }
      }
    },

    // The bundled list has no per-query cache to clear; keep the call a no-op.
    'hpo:clearCache': {
      handle() {
        return { success: true }
      }
    }
  }
}
