/**
 * The cohort table pages through useCohortData's cursor-aware query: the
 * keyset cursor a page returns is sent with the request for the page that
 * directly follows it, so deep paging does not fall back to OFFSET.
 *
 * Also pins the interaction-gate contract the table already honoured: one
 * visible-page query per sort, and no stale render when an older response
 * arrives after a newer one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createMockApi } from '../../utils/mock-api'
import { installCapabilities } from '../helpers/capabilities'
import CohortTable from '../../../src/renderer/src/components/CohortTable.vue'
import { FiltersKey, createFilters } from '../../../src/renderer/src/composables/useFilters'
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore'
import { _resetAnnotationsForTesting } from '../../../src/renderer/src/composables/useAnnotations'

const vuetify = createVuetify({ components, directives })

/** Stands in for the Vuetify server table: exposes the rows and emits update:options. */
const CohortDataTableStub = defineComponent({
  name: 'CohortDataTable',
  props: {
    variants: { type: Array, default: () => [] },
    page: { type: Number, default: 1 },
    sortBy: { type: Array, default: () => [] }
  },
  emits: ['update:options', 'update:page', 'update:sortBy'],
  setup(props, { expose }) {
    expose({
      columnActiveFilters: [],
      clearAllColumnFilters: () => {},
      clearColumnFilter: () => {}
    })
    return () => h('div', { class: 'rows' }, JSON.stringify(props.variants))
  }
})

type Query = Record<string, unknown>

function row(id: string): Record<string, unknown> {
  return {
    variant_key: id,
    chr: 'chr1',
    pos: Number(id.replace(/\D/g, '')) || 1,
    ref: 'A',
    alt: 'G'
  }
}

describe('CohortTable paging', () => {
  let wrapper: VueWrapper
  let pinia: Pinia
  let getVariants: ReturnType<typeof vi.fn>
  let filtersCtx: ReturnType<typeof createFilters>

  function queries(): Query[] {
    return getVariants.mock.calls.map((call) => call[0] as Query)
  }

  function table(): VueWrapper {
    return wrapper.findComponent(CohortDataTableStub) as unknown as VueWrapper
  }

  /** What Vuetify does on a page / sort change: update the model, then emit update:options. */
  async function goToPage(page: number): Promise<void> {
    await table().vm.$emit('update:page', page)
    await table().vm.$emit('update:options')
    await flushPromises()
  }

  async function sortBy(key: string): Promise<void> {
    await table().vm.$emit('update:sortBy', [{ key, order: 'asc' }])
    await nextTick()
    await table().vm.$emit('update:options')
    await flushPromises()
  }

  function shownRows(): string[] {
    return (JSON.parse(wrapper.find('.rows').text()) as Array<{ variant_key: string }>).map(
      (v) => v.variant_key
    )
  }

  beforeEach(async () => {
    pinia = createPinia()
    setActivePinia(pinia)
    // The capability store fails closed: cohort queries need a document.
    installCapabilities()
    _resetAnnotationsForTesting()
    const api = createMockApi()
    window.api = api as unknown as typeof window.api
    getVariants = vi.fn(async (params: Query) => {
      const offset = (params.offset as number | undefined) ?? 0
      const limit = params.limit as number
      return {
        data: [row(`v${offset}`)],
        total_count: 1000,
        next_cursor: `cursor-after-${offset + limit}`
      }
    })
    window.api.cohort.getVariants = getVariants as never
    // Adjacent-page prefetch is exercised separately; keep the default flow deterministic.
    useSettingsStore(pinia).prefetchEnabled = false

    filtersCtx = createFilters()
    wrapper = mount(CohortTable, {
      global: {
        plugins: [vuetify, pinia],
        provide: { [FiltersKey as symbol]: filtersCtx },
        stubs: {
          CohortDataTable: CohortDataTableStub,
          CohortFilterBar: true,
          AnnotationDialogs: true
        }
      }
    })
    await flushPromises()
    // Vuetify's server table emits update:options once on mount.
    await table().vm.$emit('update:options')
    await flushPromises()
  })

  afterEach(() => {
    wrapper.unmount()
    vi.restoreAllMocks()
  })

  it('sends the cursor of the previous page with the next page request', async () => {
    const limit = queries()[0].limit as number
    expect(queries()[0]).not.toHaveProperty('cursor')

    await goToPage(2)
    await goToPage(3)

    expect(queries()).toHaveLength(3)
    expect(queries()[1]).toMatchObject({ offset: limit, cursor: `cursor-after-${limit}` })
    expect(queries()[2]).toMatchObject({ offset: 2 * limit, cursor: `cursor-after-${2 * limit}` })
    expect(shownRows()).toEqual([`v${2 * limit}`])
  })

  // #485: the exported file must contain exactly the rows the table shows.
  it('exports with the same filter params as the table query', async () => {
    const exportCohort = vi.fn(async () => ({ success: true, filePath: '/tmp/cohort.xlsx' }))
    window.api.export.cohort = exportCohort as never
    filtersCtx.filters.value.starredOnly = true
    filtersCtx.filters.value.activePanelIds = [7]
    await table().vm.$emit('column-filters-change', {
      cadd_phred: { operator: '>=', value: 25 }
    })
    await vi.waitFor(() => expect(queries().at(-1)).toHaveProperty('column_filters'))

    await wrapper.findComponent({ name: 'CohortFilterBar' }).vm.$emit('export')
    await flushPromises()

    const tableFilters = { ...(queries().at(-1) as Query) }
    for (const paging of ['limit', 'offset', 'sort_by', 'sort_order', '_count_needed', 'cursor']) {
      delete tableFilters[paging]
    }
    expect(tableFilters).toMatchObject({
      starred_only: true,
      active_panel_ids: [7],
      column_filters: { cadd_phred: { operator: '>=', value: 25 } }
    })
    expect(exportCohort.mock.calls[0][0]).toEqual(tableFilters)
  })

  it('reuses the cursor although only page 1 asks for the count', async () => {
    await goToPage(2)

    expect(queries()[0]._count_needed).toBe(true)
    expect(queries()[1]).toMatchObject({ _count_needed: false })
    expect(queries()[1]).toHaveProperty('cursor')
  })

  it('does not send a cursor of another sort order', async () => {
    await sortBy('gene_symbol')
    const afterSort = queries().at(-1) as Query

    expect(afterSort).toMatchObject({ sort_by: 'gene_symbol' })
    expect(afterSort).not.toHaveProperty('cursor')
  })

  it('issues exactly one visible-page query per sort', async () => {
    const before = queries().length

    await sortBy('gene_symbol')

    expect(queries().length - before).toBe(1)
  })

  it('prefetches the adjacent page with the cursor too', async () => {
    useSettingsStore(pinia).prefetchEnabled = true
    const limit = queries()[0].limit as number
    await goToPage(2)

    // The prefetch runs when the renderer is idle.
    const next = await vi.waitFor(() => {
      const query = queries().find((q) => q.offset === 2 * limit)
      expect(query).toBeDefined()
      return query
    })
    expect(next).toMatchObject({ cursor: `cursor-after-${2 * limit}`, _count_needed: false })
  })

  it('renders the newest request when an older response arrives late', async () => {
    const limit = queries()[0].limit as number
    let releaseSlow!: () => void
    getVariants.mockImplementationOnce(
      (params: Query) =>
        new Promise((resolve) => {
          releaseSlow = () =>
            resolve({ data: [row(`slow${params.offset as number}`)], total_count: 1000 })
        })
    )

    // Page 2 is slow; the user moves on to page 3 before it answers.
    await table().vm.$emit('update:page', 2)
    await table().vm.$emit('update:options')
    await goToPage(3)
    expect(shownRows()).toEqual([`v${2 * limit}`])

    releaseSlow()
    await flushPromises()
    expect(shownRows()).toEqual([`v${2 * limit}`])
  })
})
