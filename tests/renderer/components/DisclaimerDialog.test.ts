import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import DisclaimerDialog from '../../../src/renderer/src/components/DisclaimerDialog.vue'

const vuetify = createVuetify({ components, directives })

describe('DisclaimerDialog a11y (#669)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('provides a focusable scrollable region with role="region" and aria-label (#669)', async () => {
    const wrapper = mount(DisclaimerDialog, {
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    ;(wrapper.vm as unknown as { show: () => void }).show()
    await flushPromises()

    const scrollableRegion = document.body.querySelector('[role="region"]')
    expect(scrollableRegion).not.toBeNull()
    expect(scrollableRegion?.getAttribute('tabindex')).toBe('0')
    expect(scrollableRegion?.getAttribute('aria-label')).toBe('Disclaimer text')
    wrapper.unmount()
  })
})
