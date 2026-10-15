import { getHpoDataStatus } from '../../../main/ipc/handlers/hpo-data-logic'
import { HpoExplainGeneArgsSchema } from '../../../shared/ipc/domains/hpo-data'
import type { OverrideHandler } from './types'

/**
 * HPO similarity data status. The operator installs `hpo_similarity.db` and
 * points `VARLENS_HPO_DB_PATH` at it; without it the status reads "not
 * installed" and the ranking's `hpo_resnik` stays null. Updates are desktop-only.
 */
export function buildHpoDataOverrides(): Record<string, OverrideHandler> {
  return {
    'hpo-data:status': {
      handle() {
        return getHpoDataStatus()
      }
    },
    'hpo-data:explainGene': {
      async handle(args, _request, reply, { session }) {
        const parsed = HpoExplainGeneArgsSchema.safeParse(args)
        if (!parsed.success) {
          reply.code(400)
          return { error: 'invalid-params', message: 'Expected a case id and a gene symbol' }
        }
        return await session
          .getReadExecutor()
          .execute({ type: 'hpo:explainGene', params: parsed.data })
      }
    }
  }
}
