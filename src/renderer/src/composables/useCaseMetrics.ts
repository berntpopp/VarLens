/**
 * The metric values of one case and the metric catalog, with their writes.
 *
 * Reads come from the query cache (`queries/case-metrics.ts`) and follow the
 * case passed in; a case id of 0 reads nothing. A write resolves once what it
 * changed has been refetched.
 */

import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@pinia/colada'
import type {
  MetricDefinition,
  CaseMetricWithDefinition,
  MetricValue
} from '../../../shared/types/api'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { caseMetricsQuery, metricDefinitionsQuery } from '../queries/case-metrics'
import { queryApi } from '../queries/gate'
import { refetchAfterWrite } from '../queries/invalidation'
import { queryKeys } from '../queries/keys'

export function useCaseMetrics(caseId: MaybeRefOrGetter<number>) {
  const { data: definitionData } = useQuery(metricDefinitionsQuery)
  const { data, isPending } = useQuery(() => caseMetricsQuery(toValue(caseId)))
  const definitions = computed<MetricDefinition[]>(() => definitionData.value ?? [])
  const metrics = computed<CaseMetricWithDefinition[]>(() => data.value ?? [])

  async function upsertMetric(metricId: number, value: MetricValue): Promise<void> {
    const id = toValue(caseId)
    const key = queryKeys.caseMetrics(id)
    unwrapIpcResult(await queryApi().caseMetrics.upsert(id, metricId, value))
    await refetchAfterWrite(key)
  }

  async function deleteMetric(metricId: number): Promise<void> {
    const id = toValue(caseId)
    const key = queryKeys.caseMetrics(id)
    unwrapIpcResult(await queryApi().caseMetrics.delete(id, metricId))
    await refetchAfterWrite(key)
  }

  async function createDefinition(
    name: string,
    valueType: 'numeric' | 'text' | 'date',
    unit: string,
    category: string
  ): Promise<MetricDefinition> {
    const key = queryKeys.metricDefinitions()
    const definition = unwrapIpcResult(
      await queryApi().caseMetrics.createDefinition(name, valueType, unit, category)
    )
    await refetchAfterWrite(key)
    return definition
  }

  return {
    definitions,
    metrics,
    isLoading: isPending,
    upsertMetric,
    deleteMetric,
    createDefinition
  }
}
