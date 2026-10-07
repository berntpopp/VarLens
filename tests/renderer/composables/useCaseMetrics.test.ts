/**
 * useCaseMetrics: one case's metric values and the metric catalog, read from
 * the query cache, and the writes that refetch them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import type { Pinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { useCaseMetrics } from '@renderer/composables/useCaseMetrics'
import type { CaseMetricWithDefinition, MetricDefinition } from '../../../src/shared/types/api'
import { invalidateServerData } from '../../../src/renderer/src/queries/invalidation'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { createQueryPinia, withQueries } from '../helpers/with-queries'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

const metric = (caseId: number, metricId = 7): CaseMetricWithDefinition =>
  ({
    id: caseId * 100 + metricId,
    case_id: caseId,
    metric_id: metricId
  }) as CaseMetricWithDefinition

const definition = (id: number, name = `metric ${id}`): MetricDefinition =>
  ({ id, name, category: 'QC', value_type: 'numeric' }) as MetricDefinition

const failure = { code: 'DB_ERROR', message: 'boom', userMessage: 'boom' }

describe('useCaseMetrics', () => {
  const listDefinitions = vi.fn()
  const listForCase = vi.fn()
  const upsert = vi.fn()
  const remove = vi.fn()
  const createDefinition = vi.fn()
  const hosts: Array<{ unmount: () => void }> = []
  let pinia: Pinia

  function mountMetrics(caseId = ref(1)) {
    const host = withQueries(() => useCaseMetrics(caseId), pinia)
    hosts.push(host)
    return { ...host.result, caseId }
  }

  beforeEach(() => {
    listDefinitions.mockReset().mockResolvedValue([definition(7)])
    listForCase.mockReset().mockImplementation(async (caseId: number) => [metric(caseId)])
    upsert.mockReset().mockResolvedValue(undefined)
    remove.mockReset().mockResolvedValue(undefined)
    createDefinition.mockReset().mockResolvedValue(definition(8, 'Custom'))
    Object.assign(window, {
      api: {
        caseMetrics: { listDefinitions, listForCase, upsert, delete: remove, createDefinition }
      }
    })
    pinia = createQueryPinia()
  })

  afterEach(() => hosts.splice(0).forEach((host) => host.unmount()))

  it('loads the catalog and the metrics of the case', async () => {
    const { definitions, metrics, isLoading } = mountMetrics(ref(3))
    expect(isLoading.value).toBe(true)
    await flushPromises()

    expect(listForCase).toHaveBeenCalledExactlyOnceWith(3)
    expect(metrics.value).toEqual([metric(3)])
    expect(definitions.value).toEqual([definition(7)])
    expect(isLoading.value).toBe(false)
  })

  it('loads the catalog once, and each case again when its view mounts', async () => {
    mountMetrics()
    await flushPromises()
    mountMetrics()
    await flushPromises()

    expect(listDefinitions).toHaveBeenCalledTimes(1)
    expect(listForCase).toHaveBeenCalledTimes(2)
  })

  it('never shows the previous case when its response arrives last', async () => {
    let resolveFirst: (value: CaseMetricWithDefinition[]) => void = () => {}
    listForCase.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
    const { metrics, caseId } = mountMetrics()
    await flushPromises()

    caseId.value = 2
    await flushPromises()
    resolveFirst([metric(1)])
    await flushPromises()

    expect(metrics.value).toEqual([metric(2)])
  })

  it("does not show another database's metrics or catalog", async () => {
    const { metrics, definitions } = mountMetrics()
    await flushPromises()
    listForCase.mockResolvedValue([metric(1, 42)])
    listDefinitions.mockResolvedValue([definition(42)])

    useDatabaseStore().revision++
    await invalidateServerData('database-switch')
    await flushPromises()

    expect(metrics.value).toEqual([metric(1, 42)])
    expect(definitions.value).toEqual([definition(42)])
  })

  it('refetches once after an import or a case delete', async () => {
    mountMetrics()
    await flushPromises()
    listForCase.mockClear()

    await invalidateServerData('data-changed')
    await flushPromises()
    expect(listForCase).toHaveBeenCalledTimes(1)
  })

  it('upsert and delete refetch the case before they resolve', async () => {
    const { metrics, upsertMetric, deleteMetric } = mountMetrics()
    await flushPromises()

    listForCase.mockResolvedValue([metric(1), metric(1, 8)])
    await upsertMetric(8, { numeric_value: 30 })
    expect(upsert).toHaveBeenCalledWith(1, 8, { numeric_value: 30 })
    expect(metrics.value).toHaveLength(2)

    listForCase.mockResolvedValue([metric(1, 8)])
    await deleteMetric(7)
    expect(remove).toHaveBeenCalledWith(1, 7)
    expect(metrics.value).toEqual([metric(1, 8)])
  })

  it('creating a definition returns it and refetches the catalog', async () => {
    const { definitions, createDefinition: create } = mountMetrics()
    await flushPromises()
    listDefinitions.mockResolvedValue([definition(7), definition(8, 'Custom')])

    await expect(create('Custom', 'numeric', 'x', 'QC')).resolves.toEqual(definition(8, 'Custom'))
    expect(definitions.value.map((d) => d.id)).toEqual([7, 8])
  })

  it('a failed write rejects without a refetch; a failed refetch does not fail the write', async () => {
    const { metrics, upsertMetric, deleteMetric } = mountMetrics()
    await flushPromises()
    listForCase.mockClear()

    remove.mockResolvedValue(failure)
    await expect(deleteMetric(7)).rejects.toMatchObject({ code: 'DB_ERROR' })
    expect(listForCase).not.toHaveBeenCalled()

    listForCase.mockResolvedValue(failure)
    await expect(upsertMetric(7, { numeric_value: 1 })).resolves.toBeUndefined()
    expect(metrics.value).toEqual([metric(1)])
  })
})
