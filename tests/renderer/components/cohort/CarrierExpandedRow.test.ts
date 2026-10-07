/**
 * Tests for CarrierExpandedRow.vue
 *
 * A failed carrier load must be told apart from a variant without carriers:
 * the row shows the failure and offers a retry instead of an empty table.
 */

import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CarrierExpandedRow from '../../../../src/renderer/src/components/cohort/CarrierExpandedRow.vue'
import type { CohortCarrier } from '../../../../src/shared/types/cohort'

const vuetify = createVuetify({ components, directives })

function mountRow(props: { carriers: CohortCarrier[]; error?: boolean }) {
  return mount(CarrierExpandedRow, {
    global: { plugins: [vuetify] },
    props: { colspan: 5, ...props },
    attachTo: document.createElement('tbody')
  })
}

describe('CarrierExpandedRow', () => {
  it('lists the carriers', () => {
    const wrapper = mountRow({
      carriers: [{ case_id: 1, case_name: 'Case A', gt_num: '0/1' }]
    })

    expect(wrapper.text()).toContain('Case A')
    expect(wrapper.text()).toContain('het')
    expect(wrapper.find('[data-testid="carrier-load-error"]').exists()).toBe(false)
  })

  it('shows the failure and emits retry when the load failed', async () => {
    const wrapper = mountRow({ carriers: [], error: true })

    const failure = wrapper.find('[data-testid="carrier-load-error"]')
    expect(failure.exists()).toBe(true)
    expect(failure.text()).toContain('Carriers could not be loaded')

    await wrapper.find('[data-testid="carrier-load-retry"]').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })
})
