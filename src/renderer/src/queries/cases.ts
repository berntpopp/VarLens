import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { queryApi } from './gate'
import { queryKeys } from './keys'

/** Ids of every case in the open database: the scope of the cohort view. */
export const caseIdsQuery = defineQueryOptions(() => ({
  key: queryKeys.caseIds(),
  query: async () => unwrapIpcResult(await queryApi().cases.list()).map((c) => c.id)
}))
