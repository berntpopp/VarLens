import { GeneListSetGenesArgsSchema } from '../../../shared/api/schemas/gene-lists'
import { getWebGeneReferenceService } from '../web-gene-reference'
import type { OverrideHandler } from './types'

/** Symbols the bundled HGNC gene reference does not know (case-insensitive). */
function unknownGeneSymbols(genes: string[]): string[] {
  if (genes.length === 0) return []
  return getWebGeneReferenceService()
    .validateSymbols(genes)
    .filter((result) => result.status === 'unknown')
    .map((result) => result.input)
}

export function buildGeneListOverrides(): Record<string, OverrideHandler> {
  return {
    'gene-lists:setGenes': {
      async handle(args, _request, reply, { session }) {
        const parsed = GeneListSetGenesArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-gene-list-genes' }
        }
        const [listId, genes] = parsed.data
        // Gene lists filter variants by gene symbol: a typo such as NOTAGENE1
        // would silently match nothing, so unknown symbols are rejected.
        const unknown = unknownGeneSymbols(genes)
        if (unknown.length > 0) {
          reply.code(400)
          return {
            error: 'unknown-gene-symbols',
            message: `Not recognised as HGNC gene symbols: ${unknown.slice(0, 20).join(', ')}`,
            unknown
          }
        }
        await session.getWriteExecutor().execute({
          type: 'gene-lists:setGenes',
          params: [listId, genes]
        })
        return await session.getReadExecutor().execute({
          type: 'gene-lists:getGenes',
          params: [listId]
        })
      }
    }
  }
}
