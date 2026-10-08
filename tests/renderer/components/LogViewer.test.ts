/**
 * The log viewer is a fixed panel mounted outside v-main, so it does not
 * inherit Vuetify's --v-layout-bottom; it has to take the inset from the
 * layout itself or it covers the footer and its own toggle (#476).
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import LogViewer from '../../../src/renderer/src/components/LogViewer.vue'

vi.mock('../../../src/renderer/src/services/LogService', () => ({
  logService: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

describe('LogViewer', () => {
  it('anchors the open panel above the layout footer', async () => {
    setActivePinia(createPinia())
    const wrapper = mount(
      {
        render: () =>
          h(components.VApp, null, () => [
            h(components.VFooter, { app: true, height: 40 }),
            h(LogViewer, { open: true })
          ])
      },
      {
        attachTo: document.body,
        global: { plugins: [createVuetify({ components, directives })] }
      }
    )
    await flushPromises()

    const panel = wrapper.find<HTMLElement>('.log-viewer-panel')
    expect(panel.element.style.bottom).toBe('40px')

    wrapper.unmount()
  })
})
