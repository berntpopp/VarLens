import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import NumericRangeControl from '../../../../src/renderer/src/components/filters/NumericRangeControl.vue'

const vuetify = createVuetify({ components, directives })

function mountControl(props: Record<string, unknown> = {}) {
  return mount(NumericRangeControl, {
    props,
    global: { plugins: [vuetify] }
  })
}

describe('NumericRangeControl', () => {
  it('renders select and text field without being disabled on empty initial state', () => {
    const wrapper = mountControl()
    const textField = wrapper.findComponent({ name: 'VTextField' })
    expect(textField.exists()).toBe(true)
    expect(textField.props('disabled')).toBeFalsy()
  })

  it('allows picking an operator before entering a value and emits once value is entered', async () => {
    const wrapper = mountControl()
    const select = wrapper.findComponent({ name: 'VSelect' })
    const textField = wrapper.findComponent({ name: 'VTextField' })

    // Select '='
    select.vm.$emit('update:modelValue', '=')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    const input = wrapper.find('input[type="number"]')
    await input.setValue('0')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted?.at(-1)?.[0]).toEqual({
      operator: '=',
      value: 0,
      includeEmpty: false
    })
  })

  it('uses default operator >= when entering a value without selecting operator first', async () => {
    const wrapper = mountControl()
    const input = wrapper.find('input[type="number"]')

    await input.setValue('100')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted?.at(-1)?.[0]).toEqual({
      operator: '>=',
      value: 100,
      includeEmpty: false
    })
  })

  it('updates operator and re-emits when value is already present', async () => {
    const wrapper = mountControl({
      modelValue: { operator: '>=', value: 50, includeEmpty: false }
    })
    const select = wrapper.findComponent({ name: 'VSelect' })

    select.vm.$emit('update:modelValue', '<=')
    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted).toBeTruthy()
    expect(emitted?.at(-1)?.[0]).toEqual({
      operator: '<=',
      value: 50,
      includeEmpty: false
    })
  })

  it('emits undefined when clear button is clicked or value is emptied', async () => {
    const wrapper = mountControl({
      modelValue: { operator: '>=', value: 50, includeEmpty: false }
    })
    const clearBtn = wrapper.findComponent({ name: 'VBtn' })
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toBeUndefined()
  })
})
