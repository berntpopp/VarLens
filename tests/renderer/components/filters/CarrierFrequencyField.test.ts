import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CarrierFrequencyField from '../../../../src/renderer/src/components/filters/CarrierFrequencyField.vue'
import { CARRIER_FREQUENCY_COPY } from '../../../../src/renderer/src/config/uiCopyConfig'

const vuetify = createVuetify({ components, directives })
const field = (modelValue: number | null) =>
  mount(CarrierFrequencyField, { global: { plugins: [vuetify] }, props: { modelValue } })

describe('CarrierFrequencyField (case and cohort drawers)', () => {
  it('says the frequency counts patients here, not a population', () => {
    expect(field(null).text()).toContain(CARRIER_FREQUENCY_COPY.hint)
  })

  it('emits a preset fraction and a custom percentage as a fraction', async () => {
    const wrapper = field(null)
    await wrapper.findAll('.v-chip')[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([0.05])
    await wrapper.find('input').setValue('2')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([0.02])
  })
})
