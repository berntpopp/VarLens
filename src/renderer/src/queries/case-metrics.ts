import { defineQueryOptions } from '@pinia/colada'

import { unwrapIpcResult } from '../../../shared/types/errors'
import { ALWAYS_STALE } from './client'
import { canQuery, queryApi } from './gate'
import { queryKeys } from './keys'

/** The metric catalog of the open database (predefined and user-created). */
export const metricDefinitionsQuery = defineQueryOptions(() => ({
  key: queryKeys.metricDefinitions(),
  query: async () => unwrapIpcResult(await queryApi().caseMetrics.listDefinitions()),
  enabled: canQuery('workflow.caseMetrics')
}))

/** A case's metric values, joined with their definitions. */
export const caseMetricsQuery = defineQueryOptions((caseId: number) => ({
  key: queryKeys.caseMetrics(caseId),
  query: async () => unwrapIpcResult(await queryApi().caseMetrics.listForCase(caseId)),
  enabled: caseId > 0 && canQuery('workflow.caseMetrics'),
  staleTime: ALWAYS_STALE
}))
