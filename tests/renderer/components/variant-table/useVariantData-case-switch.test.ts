/**
 * Regression: P0-3 stuck skeleton (ui-ux-audit-2026-10-06).
 *
 * Case A → Cohort → pick case B in the sidebar → SNV/Indel tab showed a
 * skeleton forever and never queried. The case switch happened while the
 * table was hidden (KeepAlive-deactivated / Shortlist tab), `resetState()`
 * cleared rows and set loading, and nothing ever issued the query because
 * Vuetify's `update:options` does not fire when page/sort are unchanged.
 *
 * Uses the real useOffsetPagination so the behaviour boundary (which queries
 * reach the API) is what is asserted.
 */
import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { withSetup, flushPromises } from '../../../utils/test-helpers'
import type { Variant, VariantFilter } from '../../../../src/shared/types/api'
import { useSettingsStore } from '../../../../src/renderer/src/stores/settingsStore'

const queryMock = vi.fn()

vi.mock('../../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({ api: { variants: { query: queryMock } } })
}))

vi.mock('../../../../src/renderer/src/composables/useAnnotations', () => ({
  useAnnotations: () => ({
    loadAnnotationsBatch: vi.fn(),
    invalidateAnnotationGeneration: vi.fn(),
    clearCache: vi.fn()
  })
}))

import { useVariantData } from '../../../../src/renderer/src/components/variant-table/useVariantData'

function rowsFor(caseId: number): Variant[] {
  return [{ id: caseId * 100, case_id: caseId, chr: '1', pos: 1, ref: 'A', alt: 'T' } as Variant]
}

function ok<T>(data: T): T {
  return data
}

describe('useVariantData case switch while hidden (P0-3)', () => {
  let app: { unmount: () => void } | undefined

  beforeEach(() => {
    setActivePinia(createPinia())
    useSettingsStore().prefetchEnabled = false
    queryMock.mockReset()
    queryMock.mockImplementation(async (caseId: number) =>
      ok({ data: rowsFor(caseId), total_count: caseId * 10, unfiltered_count: caseId * 10 })
    )
  })

  afterEach(() => {
    app?.unmount()
    app = undefined
  })

  function setup() {
    const caseId = ref(1)
    const filters = ref<Omit<VariantFilter, 'case_id'>>({ variant_type: 'snv' })
    const active = ref(true)
    const onCountsUpdate = vi.fn()
    const [data, appInstance] = withSetup(() =>
      useVariantData({ caseId, filters, active, onCountsUpdate, onSortUpdate: vi.fn() })
    )
    app = appInstance
    return { caseId, filters, active, data, onCountsUpdate }
  }

  const queriedCases = () => queryMock.mock.calls.map((c) => c[0] as number)

  it('queries the new case when the table becomes visible again', async () => {
    const { caseId, active, data } = setup()
    await data.loadVariants() // initial Vuetify update:options
    expect(data.variants.value.map((v) => v.case_id)).toEqual([1])

    active.value = false // navigate to Cohort (KeepAlive deactivates)
    caseId.value = 2 // pick case B in the sidebar
    await flushPromises()

    active.value = true // land back on the SNV/Indel tab
    await flushPromises()

    expect(queriedCases()).toContain(2)
    expect(data.loading.value).toBe(false)
    expect(data.variants.value.map((v) => v.case_id)).toEqual([2])
    expect(data.totalCount.value).toBe(20)
  })

  it('reloads on a visible case switch without relying on update:options', async () => {
    const { caseId, data } = setup()
    await data.loadVariants()

    caseId.value = 2
    await flushPromises()

    expect(queriedCases()).toEqual([1, 2])
    expect(data.loading.value).toBe(false)
    expect(data.variants.value.map((v) => v.case_id)).toEqual([2])
  })

  it('applies filter changes made while hidden once visible again', async () => {
    const { filters, active, data } = setup()
    await data.loadVariants()

    active.value = false
    filters.value = { variant_type: 'snv', search_query: 'BRCA2' }
    await nextTick()
    expect(queryMock).toHaveBeenCalledTimes(1)

    active.value = true
    await flushPromises()

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls[1][1]).toMatchObject({ search_query: 'BRCA2' })
  })

  it('reports the new case unfiltered total, not the previous case total', async () => {
    const { caseId, data, onCountsUpdate } = setup()
    await data.loadVariants()
    queryMock.mockImplementation(async (id: number) =>
      // Same filtered total as case 1 so the totalCount watcher alone would not fire.
      ok({ data: rowsFor(id), total_count: 10, unfiltered_count: 99 })
    )
    caseId.value = 2
    await flushPromises()

    expect(onCountsUpdate).toHaveBeenLastCalledWith({ filtered: 10, total: 99 })
  })
})
