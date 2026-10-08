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

vi.mock('../../../../src/renderer/src/composables/useAssociation', () => ({
  useAssociation: () => ({
    runAssociation: vi.fn(),
    cancelAssociation: vi.fn(),
    onAssociationProgress: vi.fn(() => () => {}),
    loadCasesWithMetadata: mockLoadCasesWithMetadata,
    unavailableReason: null
  })
}))

import GeneBurdenView from '../../../../src/renderer/src/components/association/GeneBurdenView.vue'
import AssociationConfigPanel from '../../../../src/renderer/src/components/association/AssociationConfigPanel.vue'

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

    expect(typeof (wrapper.vm as any).refresh).toBe('function')
    await (wrapper.vm as any).refresh()
    await flushPromises()
    expect(mockLoadCasesWithMetadata).toHaveBeenCalledTimes(2)
  })
})
