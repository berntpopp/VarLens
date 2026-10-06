import { describe, expect, it } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import AppDialogHost from '../../../src/renderer/src/components/AppDialogHost.vue'
import { AppStateKey, createAppState } from '../../../src/renderer/src/composables/useAppState'
import { createMockApi } from '../../utils/mock-api'

;(window as Window & { api?: unknown }).api = createMockApi()

function mountHost() {
  const appState = createAppState()
  const wrapper = shallowMount(AppDialogHost, {
    global: {
      plugins: [createVuetify({ components, directives }), createPinia()],
      provide: { [AppStateKey as symbol]: appState },
      stubs: {
        DisclaimerDialog: {
          name: 'DisclaimerDialog',
          template: '<div />',
          methods: { checkAndShow: () => undefined, show: () => undefined }
        },
        // A stub exposing show() so waitForRef() resolves.
        CaseMetadataModal: {
          name: 'CaseMetadataModal',
          template: '<div />',
          methods: { show: () => undefined }
        }
      }
    }
  })
  return { wrapper, appState }
}

describe('AppDialogHost first-paint footprint', () => {
  it('does not mount the log viewer until it is first toggled open', async () => {
    const { wrapper } = mountHost()
    expect(wrapper.findComponent({ name: 'LogViewer' }).exists()).toBe(false)

    ;(wrapper.vm as unknown as { toggleLogViewer: () => void }).toggleLogViewer()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'LogViewer' }).exists()).toBe(true)
  })

  it('mounts the case metadata modal on first request, not on case selection', async () => {
    const { wrapper, appState } = mountHost()
    appState.selectCase({ caseId: 3, caseName: 'LB-3', variantCount: 1, createdAt: 0 })
    await flushPromises()
    expect(wrapper.findComponent({ name: 'CaseMetadataModal' }).exists()).toBe(false)

    void (wrapper.vm as unknown as { showCaseMetadata: () => Promise<void> }).showCaseMetadata()
    await flushPromises()
    expect(wrapper.findComponent({ name: 'CaseMetadataModal' }).exists()).toBe(true)
  })
})
