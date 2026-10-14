import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { ref } from 'vue'

vi.mock('../../../src/renderer/src/utils/runtime-mode', () => ({ isWebRuntime: () => true }))
vi.mock('../../../src/renderer/src/composables/useCaseComments', () => ({
  useCaseComments: () => ({ comments: ref([]) })
}))
vi.mock('../../../src/renderer/src/composables/useCaseMetrics', () => ({
  useCaseMetrics: () => ({ metrics: ref([]) })
}))

import CaseMetadataModal from '../../../src/renderer/src/components/CaseMetadataModal.vue'

const vuetify = createVuetify({ components, directives })

describe('CaseMetadataModal — web tab bar', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  // A primary-coloured text button on the secondary bar had no contrast: the active
  // tab must be a filled button so its label sits on its own background.
  it('fills the active tab and leaves the others as text buttons', async () => {
    const wrapper = mount(CaseMetadataModal, {
      props: { caseId: 1, caseName: 'case-a', variantCount: 3, createdAt: 0 },
      global: {
        plugins: [vuetify],
        stubs: {
          CaseMetadataCard: true,
          CaseCommentsTab: true,
          CaseMetricsTab: true,
          CaseDataInfoTab: true
        }
      },
      attachTo: document.body
    })
    ;(wrapper.vm as unknown as { show: () => void }).show()
    await flushPromises()
    const tabs = [...document.body.querySelectorAll<HTMLElement>('.metadata-tab-button')]
    const variant = (label: string): boolean =>
      tabs.find((t) => t.textContent?.includes(label))!.classList.contains('v-btn--variant-flat')
    expect(variant('Overview')).toBe(true)
    expect(variant('Comments')).toBe(false)
    wrapper.unmount()
  })
})
