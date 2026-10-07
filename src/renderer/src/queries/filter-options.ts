import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/** Filter choices (consequences, ClinVar values, numeric ranges) of one case. */
export const filterOptionsQuery = defineQueryOptions((caseId: number) => ({
  key: queryKeys.filterOptions(caseId),
  query: async () => unwrapIpcResult(await queryApi().variants.getFilterOptions(caseId)),
  enabled: canQuery('variants.filterOptions')
}))
