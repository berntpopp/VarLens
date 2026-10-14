/**
 * Opening a case with view state (deep link or #124 memory) must issue exactly
 * one visible-page variant query, already carrying that state — never a first
 * query with default filters followed by the restored one (stale render).
 *
 * Mounts the real CaseView, FilterToolbar and VariantTable under a router with
 * the URL-state sync and the view memory, as App.vue wires them.
 */
/* eslint-disable vue/one-component-per-file -- test hosts */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createPinia, setActivePinia } from 'pinia'

const variantsQuery = vi.fn()
const cohortQuery = vi.fn()
const typeCounts = vi.fn()
const CASES = [
  { id: 1, name: 'Case A', variant_count: 10, created_at: 0 },
  { id: 2, name: 'Case B', variant_count: 10, created_at: 0 }
]
const OVERRIDES: Record<string, (...args: unknown[]) => unknown> = {
  'cases.list': () => CASES,
  'system.getCapabilities': () =>
    computeCapabilityDocument({
      runtime: 'desktop',
      role: 'admin',
      storage: MOCK_SQLITE_CAPABILITIES
    }),
  'variants.typeCounts': () => typeCounts(),
  'variants.query': (...args) => variantsQuery(...args),
  'cohort.getVariants': (...args) => cohortQuery(...args)
}

/** Any other API call resolves to an empty list; `on*` listeners return an unsubscriber. */
function fakeApi(path: string[] = []): unknown {
  return new Proxy(() => undefined, {
    get: (_target, prop) => (typeof prop === 'string' ? fakeApi([...path, prop]) : undefined),
    apply: (_target, _this, args: unknown[]) => {
      const name = path.join('.')
      if (path.at(-1)?.startsWith('on') === true) return () => undefined
      const override = OVERRIDES[name]
      return Promise.resolve(override !== undefined ? override(...args) : [])
    }
  })
}
const api = fakeApi()
Object.defineProperty(window, 'api', { configurable: true, value: api })
vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({ api, isAvailable: { value: true } })
}))

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
}))

import CaseView from '../../../src/renderer/src/views/CaseView.vue'
import CohortView from '../../../src/renderer/src/views/CohortView.vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import { useCaseUrlParam } from '../../../src/renderer/src/composables/useViewUrlBindings'
import {
  _resetUrlStateForTesting,
  installUrlStateSync
} from '../../../src/renderer/src/composables/useUrlState'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'
import { useSettingsStore } from '../../../src/renderer/src/stores/settingsStore'
import { saveViewState } from '../../../src/renderer/src/utils/url-state/view-state-memory'
import { MOCK_SQLITE_CAPABILITIES } from '../../../src/renderer/src/mocks/mockApi'
import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'

const vuetify = createVuetify({ components, directives })
const Empty = defineComponent({ render: () => null })
let pinia = createPinia()
const F = '{"geneSymbol":"TTN"}'
const VIEW = `f=${encodeURIComponent(F)}&q=BRCA1&sort=-pos`

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
  // Past the typed-filter debounce (250 ms), so a late second query would show.
  await new Promise((resolve) => setTimeout(resolve, 300))
  await flushPromises()
}

async function openAt(path: string, view: Component = CaseView) {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/case', name: 'case', component: Empty },
      { path: '/cohort', name: 'cohort', component: Empty }
    ]
  })
  await router.push(path)
  const state = createAppState()
  const Host = defineComponent({
    setup() {
      installUrlStateSync(router)
      useCaseUrlParam(state)
      return () => h(components.VLayout, () => h(view))
    }
  })
  const wrapper = mount(Host, {
    global: { plugins: [vuetify, router, pinia], provide: { [AppStateKey as symbol]: state } }
  })
  await settle()
  return { wrapper, router, state }
}

/** Visible-page (offset 0) queries since the last reset: [filters, sort]. */
function firstPageQueries(): Array<{ filters: Record<string, unknown>; sort: unknown }> {
  return variantsQuery.mock.calls
    .filter((call) => call[2] === 0)
    .map((call) => ({ filters: call[1] as Record<string, unknown>, sort: call[4] }))
}

beforeEach(() => {
  localStorage.clear()
  pinia = createPinia()
  setActivePinia(pinia)
  useDatabaseStore().currentPath = '/data/a.db'
  useSettingsStore().defaultCaseTab = 'snv'
  variantsQuery.mockReset().mockResolvedValue({ data: [], total_count: 0 })
  cohortQuery.mockReset().mockResolvedValue({ data: [], total_count: 0 })
  typeCounts.mockReset().mockReturnValue({ snv: 5 })
})
afterEach(() => _resetUrlStateForTesting())

const RESTORED = { gene_symbol: 'TTN', search_query: 'BRCA1' }
const RESTORED_SORT = [{ key: 'pos', order: 'desc' }]

describe('case open issues one first-page query (#124 follow-up)', () => {
  it('without view state', async () => {
    await openAt('/case?case=1')
    expect(firstPageQueries()).toHaveLength(1)
  })

  it('with a deep link carrying f/q/sort', async () => {
    await openAt(`/case?case=1&tab=snv&${VIEW}`)
    expect(firstPageQueries()).toEqual([
      { filters: expect.objectContaining(RESTORED), sort: RESTORED_SORT }
    ])
  })

  it('with stored view memory', async () => {
    saveViewState('/data/a.db|case:1', { f: F, q: 'BRCA1', sort: '-pos' })
    const { state } = await openAt('/case?case=2')
    variantsQuery.mockClear()
    state.selectCase({ caseId: 1, caseName: 'Case A' })
    await settle()
    expect(firstPageQueries()).toEqual([
      { filters: expect.objectContaining(RESTORED), sort: RESTORED_SORT }
    ])
  })

  it('still queries once when the type counts fail to load', async () => {
    typeCounts.mockRejectedValue(new Error('counts unavailable'))
    await openAt(`/case?case=1&tab=snv&${VIEW}`)
    expect(firstPageQueries()).toEqual([
      { filters: expect.objectContaining(RESTORED), sort: RESTORED_SORT }
    ])
  })

  it('behind the Shortlist tab, waits for its filter toolbar, then queries once', async () => {
    useSettingsStore().defaultCaseTab = 'shortlist'
    const { wrapper } = await openAt(`/case?case=1&${VIEW}`)
    expect(variantsQuery).not.toHaveBeenCalled()

    const caseView = wrapper.findComponent(CaseView).vm as unknown as {
      selectedVariantType: string
    }
    caseView.selectedVariantType = 'snv'
    await settle()
    expect(firstPageQueries()).toEqual([
      { filters: expect.objectContaining(RESTORED), sort: RESTORED_SORT }
    ])
  })
})

describe('cohort open issues one first-page query (parity)', () => {
  const COHORT_RESTORED = { gene_symbol: 'TTN', search_term: 'BRCA1', sort_by: 'pos' }

  function cohortFirstPages(): Array<Record<string, unknown>> {
    return cohortQuery.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((params) => params.offset === undefined || params.offset === 0)
  }

  it('without view state', async () => {
    await openAt('/cohort', CohortView)
    expect(cohortFirstPages()).toHaveLength(1)
  })

  it('with a deep link carrying f/q/sort', async () => {
    await openAt(`/cohort?${VIEW}`, CohortView)
    expect(cohortFirstPages()).toEqual([expect.objectContaining(COHORT_RESTORED)])
  })

  it('with stored view memory', async () => {
    saveViewState('/data/a.db|cohort', { f: F, q: 'BRCA1', sort: '-pos' })
    await openAt('/cohort', CohortView)
    expect(cohortFirstPages()).toEqual([expect.objectContaining(COHORT_RESTORED)])
  })
})
