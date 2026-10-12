/**
 * #555: the case view's carrier frequency and carrier cap read the cohort
 * summary. While it is being rebuilt the view says so (summaryStale), and
 * once it is fresh a query that filters on those figures is reloaded — as
 * the cohort view does.
 */
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { withSetup, flushPromises } from '../../../utils/test-helpers'
import type { VariantFilter } from '../../../../src/shared/types/api'
import { useSettingsStore } from '../../../../src/renderer/src/stores/settingsStore'

const queryMock = vi.fn()
let emitRebuilt: (status: { is_stale: boolean }) => void = () => {}
const getSummaryStatus = vi.fn()

vi.mock('../../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({
    api: {
      variants: { query: queryMock },
      cohort: {
        getSummaryStatus,
        onSummaryRebuilt: (callback: typeof emitRebuilt) => {
          emitRebuilt = callback
          return () => undefined
        }
      }
    }
  })
}))

vi.mock('../../../../src/renderer/src/composables/useAnnotations', () => ({
  useAnnotations: () => ({
    loadAnnotationsBatch: vi.fn(),
    invalidateAnnotationGeneration: vi.fn(),
    clearCache: vi.fn()
  })
}))

import { useVariantData } from '../../../../src/renderer/src/components/variant-table/useVariantData'

describe('useVariantData and a stale cohort summary (#555)', () => {
  let app: { unmount: () => void } | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    useSettingsStore().prefetchEnabled = false
    queryMock.mockReset()
    queryMock.mockResolvedValue({ data: [], total_count: 0, unfiltered_count: 0 })
    getSummaryStatus.mockReset()
    getSummaryStatus.mockResolvedValue({ is_stale: true, last_rebuilt_at: 0 })
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
  })

  function setup(filter: Omit<VariantFilter, 'case_id'>) {
    const [data, appInstance] = withSetup(() =>
      useVariantData({
        caseId: ref(1),
        filters: ref(filter),
        onCountsUpdate: vi.fn(),
        onSortUpdate: vi.fn()
      })
    )
    app = appInstance
    return data
  }

  it('says the summary is stale and reloads a carrier-filtered query once it is fresh', async () => {
    const data = setup({ carrier_count_max: 1 })
    await data.loadVariants()
    await flushPromises()
    expect(data.summaryStale.value).toBe(true)
    const before = queryMock.mock.calls.length

    emitRebuilt({ is_stale: false })
    await flushPromises()
    expect(data.summaryStale.value).toBe(false)
    expect(queryMock.mock.calls.length).toBeGreaterThan(before)
  })

  it('does not reload a query that uses no summary figure', async () => {
    const data = setup({ variant_type: 'snv' })
    await data.loadVariants()
    await flushPromises()
    const before = queryMock.mock.calls.length
    emitRebuilt({ is_stale: false })
    await flushPromises()
    expect(queryMock.mock.calls.length).toBe(before)
  })
})
