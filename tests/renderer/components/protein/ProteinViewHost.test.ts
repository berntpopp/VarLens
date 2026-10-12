/** The shell's protein view: the modal when it can open, else the reason, never a lookup then. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import { AppStateKey, createAppState } from '../../../../src/renderer/src/composables/useAppState'
import ProteinViewHost from '../../../../src/renderer/src/components/protein/ProteinViewHost.vue'
import { PROTEIN_VIEW_COPY } from '../../../../src/renderer/src/config/proteinViewConfig'
import { createMockApi } from '../../../utils/mock-api'
import { installCapabilities } from '../../helpers/capabilities'

const vuetify = createVuetify({ components, directives })
const variant = { id: 1, chr: 'chr22', pos: 1, ref: 'A', alt: 'G', gene_symbol: 'THOC5' }
type TestWindow = Window & { api?: unknown; __VARLENS_WEB__?: boolean }

function mountHost(runtime: 'desktop' | 'web', lookupsOn: boolean, aaChange: string | null) {
  setActivePinia(createPinia())
  installCapabilities({ runtime, role: 'user', instanceFeatures: { proteinViewer: lookupsOn } })
  const state = createAppState()
  state.openProteinView({ ...variant, aa_change: aaChange } as never, 'gene-structure')
  const wrapper = shallowMount(ProteinViewHost, {
    global: {
      plugins: [vuetify],
      provide: { [AppStateKey as symbol]: state },
      stubs: Object.fromEntries(
        ['ProteinVisualizationModal', 'ProteinViewUnavailableDialog'].map((name) => [
          name,
          { name, props: ['reason', 'initialTab'], template: '<div />' }
        ])
      )
    }
  })
  return { wrapper, state }
}

describe('ProteinViewHost', () => {
  const testWindow = window as TestWindow
  let api: ReturnType<typeof createMockApi>

  beforeEach(() => {
    api = createMockApi()
    testWindow.api = api
  })
  afterEach(() => delete testWindow.__VARLENS_WEB__)

  it('desktop: opens the modal on the requested tab', async () => {
    const { wrapper } = mountHost('desktop', false, 'p.Met180Val')
    await flushPromises()
    const modal = wrapper.findComponent({ name: 'ProteinVisualizationModal' })
    expect(modal.exists()).toBe(true)
    expect(modal.props('initialTab')).toBe('gene-structure')
  })

  it('web, lookups off: the reason instead of the modal, and no protein calls', async () => {
    testWindow.__VARLENS_WEB__ = true
    const { wrapper } = mountHost('web', false, 'p.Met180Val')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ProteinVisualizationModal' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'ProteinViewUnavailableDialog' }).props('reason')).toBe(
      PROTEIN_VIEW_COPY.lookupsOff
    )
    expect(api.protein.getMapping).not.toHaveBeenCalled()
  })

  it('web, lookups enabled by an administrator: opens the modal', async () => {
    testWindow.__VARLENS_WEB__ = true
    const { wrapper } = mountHost('web', true, 'p.Met180Val')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ProteinVisualizationModal' }).exists()).toBe(true)
  })

  it('a variant without a protein position (the p shortcut): says why', async () => {
    const { wrapper } = mountHost('desktop', false, null)
    await flushPromises()
    expect(wrapper.findComponent({ name: 'ProteinViewUnavailableDialog' }).props('reason')).toBe(
      PROTEIN_VIEW_COPY.noProteinPosition
    )
  })
})
