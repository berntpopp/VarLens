import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { ALWAYS_STALE } from './client'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/** A case's comments, newest first. */
export const caseCommentsQuery = defineQueryOptions((caseId: number) => ({
  key: queryKeys.caseComments(caseId),
  query: async () => unwrapIpcResult(await queryApi().caseComments.list(caseId)),
  enabled: caseId > 0 && canQuery('workflow.caseComments'),
  staleTime: ALWAYS_STALE
}))
