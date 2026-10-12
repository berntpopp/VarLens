import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

const mockCases = [{ id: 1, name: 'Case 1', status: 'affected', sex: 'M', cohortIds: [1] }]
const mockGroups = [{ id: 1, name: 'Group 1' }]

const mockLoadCasesWithMetadata = vi.fn().mockResolvedValue({
  cases: mockCases,
  cohortGroups: mockGroups
})

const mockRunAssociation = vi.fn()

vi.mock('../../../../src/renderer/src/composables/useAssociation', () => ({
  useAssociation: () => ({
    runAssociation: mockRunAssociation,
    cancelAssociation: vi.fn(),
    onAssociationProgress: vi.fn(() => () => {}),
    loadCasesWithMetadata: mockLoadCasesWithMetadata,
    unavailableReason: null
  })
}))

import GeneBurdenView from '../../../../src/renderer/src/components/association/GeneBurdenView.vue'
import AssociationConfigPanel from '../../../../src/renderer/src/components/association/AssociationConfigPanel.vue'
import AssociationResultsTable from '../../../../src/renderer/src/components/association/AssociationResultsTable.vue'

const vuetify = createVuetify({ components, directives })

describe('GeneBurdenView', () => {
  it('mounts, loads cases into the config panel, and exposes refresh', async () => {
    const wrapper = mount(GeneBurdenView, {
      global: { plugins: [vuetify, createPinia()] }
    })

    await flushPromises()

    const panel = wrapper.findComponent(AssociationConfigPanel)
    expect(panel.exists()).toBe(true)
    expect(panel.props('allCases')).toEqual(mockCases)
    expect(panel.props('cohortGroups')).toEqual(mockGroups)

    const vm = wrapper.vm as unknown as { refresh: () => Promise<void> }
    expect(typeof vm.refresh).toBe('function')
    await vm.refresh()
    await flushPromises()
    expect(mockLoadCasesWithMetadata).toHaveBeenCalledTimes(2)
  })

  it('shows only tested genes, so the summary count matches the table', async () => {
    const gene = (gene_symbol: string, n_variants: number) => ({
      gene_symbol,
      n_variants,
      q_value: null,
      fisher: { p_value: null },
      logistic_burden: { p_value: null }
    })
    mockRunAssociation.mockResolvedValue({
      results: [gene('TESTED', 2), gene('EMPTY', 0)],
      warnings: [],
      elapsed_ms: 1000,
      primary_test: 'fisher',
      non_autosomal_variants: 0
    })
    const wrapper = mount(GeneBurdenView, {
      global: { plugins: [vuetify, createPinia()], stubs: { AssociationResultsTable: true } }
    })
    await flushPromises()
    wrapper.findComponent(AssociationConfigPanel).vm.$emit('run', {})
    await flushPromises()

    const rows = wrapper.findComponent(AssociationResultsTable).props('results') as unknown[]
    expect(rows).toHaveLength(1)
    expect(wrapper.text()).toContain('1 genes tested')
    expect(wrapper.text()).toContain('1 gene without qualifying variants not shown')
  })
})
