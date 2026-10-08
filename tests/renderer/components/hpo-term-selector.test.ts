/**
 * The selector searches the bundled HPO list in the renderer, so it works
 * offline and never calls the network-backed `hpo:search` channel (#509).
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import HpoTermSelector from '../../../src/renderer/src/components/HpoTermSelector.vue'
import { createMockApi } from '../../utils/mock-api'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))
vi.mock('../../../src/renderer/src/utils/runtime-features', () => ({
  runtimeFeatureUnavailableReason: () => null
}))

describe('HpoTermSelector', () => {
  it('finds terms in the bundled list without calling hpo:search', async () => {
    const api = createMockApi()
    api.hpo.search = vi.fn().mockRejectedValue(new Error('offline'))
    window.api = api

    const wrapper = mount(HpoTermSelector, {
      props: { modelValue: [] },
      global: { plugins: [createVuetify({ components, directives })] }
    })
    const autocomplete = wrapper.findComponent({ name: 'VAutocomplete' })
    autocomplete.vm.$emit('update:search', 'HP:0001250')

    await vi.waitFor(() =>
      expect(autocomplete.props('items')).toEqual([{ id: 'HP:0001250', name: 'Seizure' }])
    )
    expect(api.hpo.search).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
