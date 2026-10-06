import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VariantDetailsPanel from '../../../src/renderer/src/components/VariantDetailsPanel.vue'
import { createMockApi } from '../../utils/mock-api'

const vuetify = createVuetify({ components, directives })

const variant = {
  id: 1,
  chr: 'chr17',
  pos: 43_000_000,
  ref: 'A',
  alt: 'G',
  gene_symbol: 'BRCA1'
}

type TestWindow = Window & { api?: unknown; __VARLENS_WEB__?: boolean }

function mountPanel() {
  setActivePinia(createPinia())
  return shallowMount(VariantDetailsPanel, {
    props: { open: true, variant: variant as never, caseId: 1, mode: 'case' as const },
    global: {
      plugins: [vuetify],
      renderStubDefaultSlot: true,
      // Named stubs for every async section: prevents defineAsyncComponent
      // from firing dynamic imports that outlive the test environment.
      stubs: Object.fromEntries(
        [
          'ExternalLinksSection',
          'CommentsSection',
          'TagsSection',
          'AcmgClassificationPanel',
          'ActivityLogPanel',
          'ProteinVisualizationModal',
          'ProteinViewUnavailableDialog'
        ].map((name) => [name, { name, template: '<div />' }])
      )
    }
  })
}

describe('VariantDetailsPanel protein view mounting', () => {
  const testWindow = window as TestWindow
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    api = createMockApi()
    testWindow.api = api
  })

  afterEach(() => {
    delete testWindow.__VARLENS_WEB__
  })

  it('does not mount the protein modal until the user opens it (desktop)', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ProteinVisualizationModal' }).exists()).toBe(false)

    wrapper.findComponent({ name: 'VariantIdentitySection' }).vm.$emit('open-protein-view')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ProteinVisualizationModal' }).exists()).toBe(true)
  })

  it('in web mode shows an explicit unavailable state and never calls protein endpoints', async () => {
    testWindow.__VARLENS_WEB__ = true
    const wrapper = mountPanel()
    wrapper.findComponent({ name: 'VariantIdentitySection' }).vm.$emit('open-protein-view')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ProteinVisualizationModal' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ProteinViewUnavailableDialog' }).exists()).toBe(true)
    expect(api.protein.getMapping).not.toHaveBeenCalled()
  })
})
