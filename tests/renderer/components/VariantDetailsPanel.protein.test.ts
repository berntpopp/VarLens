import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
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

function mountPanel(
  runtime: 'desktop' | 'web' = 'desktop',
  proteinLookupEnabled = false,
  extra: { provide?: Record<symbol, unknown>; stubs?: Record<string, unknown> } = {}
) {
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
          'ProteinPreviewStrip'
        ].map((name) => [name, extra.stubs?.[name] ?? { name, template: '<div />' }])
      ),
      provide: extra.provide
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

  it('the identity buttons and the strip ask the shell to open the protein view on a tab', async () => {
    const state = createAppState()
    const wrapper = mountPanel('desktop', false, { provide: { [AppStateKey as symbol]: state } })
    await flushPromises()

    wrapper.findComponent({ name: 'VariantIdentitySection' }).vm.$emit('open-protein-view', '3d')
    expect(state.proteinViewOpen.value).toBe(true)
    expect(state.proteinViewRequest.value).toMatchObject({ variant: { id: 1 }, tab: '3d' })

    wrapper.findComponent({ name: 'ProteinPreviewStrip' }).vm.$emit('open', 'lollipop')
    expect(state.proteinViewRequest.value?.tab).toBe('lollipop')
  })

  it('asks the evidence editor about an unsaved draft before the selection changes', async () => {
    const state = createAppState()
    state.selectedPanelVariant.value = variant as never
    state.panelOpen.value = true
    const editor = {
      name: 'AcmgClassificationPanel',
      template: '<div />',
      setup: (_: unknown, { expose }: { expose: (exposed: object) => void }) =>
        expose({ confirmLeave: () => Promise.resolve(false) })
    }
    const wrapper = mountPanel('desktop', false, {
      provide: { [AppStateKey as symbol]: state },
      stubs: { AcmgClassificationPanel: editor }
    })
    await flushPromises()

    state.selectedPanelVariant.value = { ...variant, id: 2 } as never
    state.panelOpen.value = false
    await flushPromises()

    expect(state.selectedPanelVariant.value).toMatchObject({ id: 1 })
    expect(state.panelOpen.value).toBe(true)

    // Once the panel is gone its guard is too.
    wrapper.unmount()
    state.panelOpen.value = false
    expect(state.panelOpen.value).toBe(false)
  })
})
