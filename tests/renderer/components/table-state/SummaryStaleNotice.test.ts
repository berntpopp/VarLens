import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import SummaryStaleNotice from '../../../../src/renderer/src/components/table-state/SummaryStaleNotice.vue'
import { CARRIER_FREQUENCY_COPY } from '../../../../src/renderer/src/config/uiCopyConfig'

const vuetify = createVuetify({ components, directives })
const notice = (stale: boolean) =>
  mount(SummaryStaleNotice, { global: { plugins: [vuetify] }, props: { stale } })

describe('SummaryStaleNotice (#555)', () => {
  it('says the carrier figures may be out of date while the summary is rebuilt', () => {
    const wrapper = notice(true)
    expect(wrapper.text()).toContain(CARRIER_FREQUENCY_COPY.stale)
    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('renders nothing while the summary is current', () => {
    expect(notice(false).text()).toBe('')
  })
})
