/**
 * PanelUnmappedGenesWarning — the warning shown in the applied-filters row of
 * the shared filter toolbar when genes of the active panel are not applied.
 *
 * The case view and the cohort view are both mounted for real (their heavy
 * tables stubbed) to prove each one provides the warning to the toolbar it
 * hosts: cohort parity for this feature is asserted here.
 */
/* eslint-disable vue/one-component-per-file -- test doubles for the views' children */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, inject, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createMockApi } from '../../../utils/mock-api'

vi.mock('@renderer/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

/** The cohort view's provided filter state, captured by its (stubbed) table. */
let cohortFilters: ReturnType<typeof createFilters> | undefined

/** A table/toolbar stand-in that hosts the real shared toolbar. */
function toolbarHost(name: string): ReturnType<typeof defineComponent> {
  return defineComponent({
    name,
    emits: ['update:filters'],
    setup(_props, { expose }) {
      cohortFilters = inject(FiltersKey, undefined)
      expose({ filterOptions: { columnMeta: [] }, handleClearAll: vi.fn(), refresh: vi.fn() })
      return () =>
        h(SlimFilterToolbar, {
          filteredCount: 5,
          totalCount: 10,
          hasActiveFilters: true,
          activeFilterCount: 1,
          activeFiltersList: [{ id: 'panels', label: 'Panels', value: '1 panel(s)' }]
        })
    }
  })
}

vi.mock('@renderer/components/FilterToolbar.vue', () => ({ default: toolbarHost('FilterToolbar') }))
vi.mock('@renderer/components/CohortTable.vue', () => ({ default: toolbarHost('CohortTable') }))
vi.mock('@renderer/components/VariantTable.vue', () => ({
  default: defineComponent({
    name: 'VariantTable',
    setup(_props, { expose }) {
      expose({ refresh: vi.fn(), columns: [], columnActiveFilters: ref([]) })
      return () => h('div')
    }
  })
}))
vi.mock('@renderer/components/shortlist/ShortlistPanel.vue', () => ({
  default: defineComponent({ name: 'ShortlistPanel', render: () => h('div') })
}))
vi.mock('@renderer/components/association/GeneBurdenView.vue', () => ({
  default: defineComponent({ name: 'GeneBurdenView', render: () => h('div') })
}))

import SlimFilterToolbar from '@renderer/components/SlimFilterToolbar.vue'
import PanelUnmappedGenesWarning from '@renderer/components/panels/PanelUnmappedGenesWarning.vue'
import CohortView from '@renderer/components/CohortView.vue'
import CaseView from '@renderer/views/CaseView.vue'
import { AppStateKey, createAppState } from '@renderer/composables/useAppState'
import { FiltersKey, type createFilters } from '@renderer/composables/useFilters'
import { _resetPanelManagerState } from '@renderer/composables/usePanelManager'
import { providePanelResolutionStatus } from '@renderer/composables/usePanelResolutionStatus'
import type { PanelResolutionStatus } from '../../../../src/shared/types/panels'

const vuetify = createVuetify({ components, directives })
const WARNING = '[data-testid="panel-unmapped-genes-warning"]'

function statusOf(symbols: string[], build = 'GRCh38'): PanelResolutionStatus {
  return {
    genomeBuild: build,
    totalGenes: 120,
    unmappedCount: symbols.length,
    unmappedGenes: symbols.map((symbol, index) => ({ hgncId: `HGNC:${index + 1}`, symbol }))
  }
}

describe('PanelUnmappedGenesWarning', () => {
  let resolutionStatus: ReturnType<typeof vi.fn>
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    _resetPanelManagerState()
    window.api = createMockApi()
    resolutionStatus = window.api.panels.resolutionStatus as unknown as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  /** Mount `child` under a provider with one active panel on case 1. */
  function mountProvided(child: ReturnType<typeof defineComponent>): VueWrapper {
    const Host = defineComponent({
      setup() {
        providePanelResolutionStatus({ panelIds: ref([3]), caseId: 1 })
        return () => h(child)
      }
    })
    return mount(Host, { attachTo: document.body, global: { plugins: [vuetify] } })
  }

  it('renders nothing while every gene of the panel is mapped', async () => {
    resolutionStatus.mockResolvedValue(statusOf([]))
    wrapper = mountProvided(PanelUnmappedGenesWarning)
    await flushPromises()

    expect(wrapper.find(WARNING).exists()).toBe(false)
  })

  it('names the unmapped genes on a warning-coloured chip', async () => {
    resolutionStatus.mockResolvedValue(statusOf(['GENE1', 'GENE2', 'GENE3']))
    wrapper = mountProvided(PanelUnmappedGenesWarning)
    await flushPromises()

    const chip = wrapper.find(`${WARNING} .v-chip`)
    expect(chip.text()).toBe(
      '3 of 120 panel genes have no coordinates for GRCh38 and are not applied: GENE1, GENE2, GENE3'
    )
    expect(chip.classes()).toContain('bg-warning')
    expect(chip.attributes('role')).toBe('button')
    expect(chip.attributes('aria-label')).toContain('GENE1, GENE2, GENE3')
  })

  it('truncates a long list inline and shows the full list when opened', async () => {
    const symbols = Array.from({ length: 12 }, (_, index) => `GENE${index + 1}`)
    resolutionStatus.mockResolvedValue(statusOf(symbols))
    wrapper = mountProvided(PanelUnmappedGenesWarning)
    await flushPromises()

    const chip = wrapper.find(`${WARNING} .v-chip`)
    expect(chip.text()).toContain('GENE5 +7 more')
    expect(chip.text()).not.toContain('GENE6')

    // Opens as an overlay (hover / keyboard focus): nothing in the page moves.
    await chip.trigger('mouseenter')
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    const details = document.body.querySelector('[data-testid="panel-unmapped-genes-details"]')
    expect(details?.classList.contains('v-alert')).toBe(true)
    expect(details?.textContent).toContain(symbols.join(', '))
  })

  it('warns that coverage is unverified when the status cannot be loaded', async () => {
    resolutionStatus.mockRejectedValue(new Error('gene reference unavailable'))
    wrapper = mountProvided(PanelUnmappedGenesWarning)
    await flushPromises()

    expect(wrapper.find(`${WARNING} .v-chip`).text()).toMatch(/^Could not check/)
  })

  it('sits inside the reserved-height applied-filters row of the shared toolbar', async () => {
    resolutionStatus.mockResolvedValue(statusOf(['GENE1']))
    wrapper = mountProvided(toolbarHost('Host'))
    await flushPromises()

    expect(wrapper.find(`.applied-filters-bar ${WARNING}`).exists()).toBe(true)
    // The row's other content is still there: the warning adds to it.
    expect(wrapper.find('.applied-filters-bar').text()).toContain('Clear all')
  })

  it('case view: warns for the applied panel and the genome build of the open case', async () => {
    resolutionStatus.mockResolvedValue(statusOf(['GENE1', 'GENE2'], 'GRCh37'))
    const { useSettingsStore } = await import('@renderer/stores/settingsStore')
    useSettingsStore().defaultCaseTab = 'snv'
    Object.assign(window.api.variants, { typeCounts: vi.fn().mockResolvedValue({ snv: 10 }) })
    const state = createAppState()
    state.selectedCaseId.value = 42
    wrapper = mount(CaseView, {
      attachTo: document.body,
      global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: state } }
    })
    await flushPromises()
    expect(resolutionStatus).not.toHaveBeenCalled()
    expect(wrapper.find(WARNING).exists()).toBe(false)

    // FilterToolbar reports the filter it applies, exactly as in the app.
    wrapper
      .findComponent({ name: 'FilterToolbar' })
      .vm.$emit('update:filters', { active_panel_ids: [9, 4], panel_padding_bp: 5000 })
    await flushPromises()

    expect(resolutionStatus).toHaveBeenCalledWith({ panelIds: [4, 9], caseId: 42 })
    expect(wrapper.find(WARNING).text()).toContain(
      '2 of 120 panel genes have no coordinates for GRCh37 and are not applied: GENE1, GENE2'
    )
  })

  it('cohort view: warns for the active panel and the selected genome build', async () => {
    resolutionStatus.mockResolvedValue(statusOf(['GENE1', 'GENE2'], 'GRCh37'))
    Object.assign(window.api.cases, {
      availableBuilds: vi.fn().mockResolvedValue([{ build: 'GRCh37', caseCount: 3 }])
    })
    wrapper = mount(CohortView, {
      attachTo: document.body,
      global: { plugins: [vuetify], provide: { [AppStateKey as symbol]: createAppState() } }
    })
    await flushPromises()
    expect(resolutionStatus).not.toHaveBeenCalled()
    expect(wrapper.find(WARNING).exists()).toBe(false)

    // Activate a panel through the cohort's own (provided) filter state.
    cohortFilters?.filters.value.activePanelIds.push(4)
    await flushPromises()

    expect(resolutionStatus).toHaveBeenLastCalledWith({ panelIds: [4], genomeBuild: 'GRCh37' })
    expect(wrapper.find(WARNING).text()).toContain(
      '2 of 120 panel genes have no coordinates for GRCh37 and are not applied: GENE1, GENE2'
    )
  })
})
