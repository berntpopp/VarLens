import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import VariantDetailsPanel from '../../../src/renderer/src/components/VariantDetailsPanel.vue'
import { createMockApi } from '../../utils/mock-api'
import { installCapabilities } from '../helpers/capabilities'

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

function mountPanel(runtime: 'desktop' | 'web' = 'desktop', proteinLookupEnabled = false) {
  setActivePinia(createPinia())
  installCapabilities({
    runtime,
    role: 'user',
    instanceFeatures: { proteinViewer: proteinLookupEnabled }
  })
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

  it('web, protein lookup off (egress policy default): reason shown, no protein calls', async () => {
    testWindow.__VARLENS_WEB__ = true
    const wrapper = mountPanel('web')
    wrapper.findComponent({ name: 'VariantIdentitySection' }).vm.$emit('open-protein-view')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ProteinVisualizationModal' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ProteinViewUnavailableDialog' }).exists()).toBe(true)
    expect(api.protein.getMapping).not.toHaveBeenCalled()
    expect(
      wrapper.findComponent({ name: 'ProteinViewUnavailableDialog' }).attributes('reason')
    ).toMatch(/Protein view .* turned off on this server/)
  })

  it('web, protein lookup enabled by an administrator: mounts the protein modal', async () => {
    testWindow.__VARLENS_WEB__ = true
    const wrapper = mountPanel('web', true)
    wrapper.findComponent({ name: 'VariantIdentitySection' }).vm.$emit('open-protein-view')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'ProteinVisualizationModal' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'ProteinViewUnavailableDialog' }).exists()).toBe(false)
  })
})
