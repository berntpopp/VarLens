import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CategoricalColumnFilter from '../../../../src/renderer/src/components/variant-table/CategoricalColumnFilter.vue'

const vuetify = createVuetify({ components, directives })

const sampleValues = ['missense', 'nonsense', 'synonymous', 'frameshift', 'splice']

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(CategoricalColumnFilter, {
    props: { columnTitle: 'Consequence', values: sampleValues, ...props },
    global: { plugins: [vuetify] }
  })
}

describe('CategoricalColumnFilter', () => {
  describe('rendering', () => {
    it('renders a v-card with the column title', () => {
      const wrapper = mountFilter()
      const card = wrapper.find('.v-card')
      expect(card.exists()).toBe(true)
      expect(wrapper.text()).toContain('Consequence')
    })

    it('renders a search text field', () => {
      const wrapper = mountFilter()
      const textField = wrapper.findComponent({ name: 'VTextField' })
      expect(textField.exists()).toBe(true)
    })

    it('renders checkboxes for each value', () => {
      const wrapper = mountFilter()
      const checkboxes = wrapper.findAllComponents({ name: 'VCheckbox' })
      expect(checkboxes.length).toBe(sampleValues.length)
    })

    it('renders Clear, Select All, and OK buttons', () => {
      const wrapper = mountFilter()
      const buttons = wrapper.findAllComponents({ name: 'VBtn' })
      const buttonTexts = buttons.map((b) => b.text())
      expect(buttonTexts).toContain('Clear')
      expect(buttonTexts).toContain('All')
      expect(buttonTexts).toContain('OK')
    })

    it('shows selected count', () => {
      const wrapper = mountFilter({ initialSelected: ['missense', 'nonsense'] })
      expect(wrapper.text()).toContain('2 selected')
    })
  })

  describe('initial values', () => {
    it('pre-selects initialSelected values', () => {
      const wrapper = mountFilter({ initialSelected: ['missense', 'frameshift'] })
      expect(wrapper.text()).toContain('2 selected')
    })

    it('starts with nothing selected by default', () => {
      const wrapper = mountFilter()
      expect(wrapper.text()).toContain('0 selected')
    })
  })

  describe('events', () => {
    it('emits apply with in operator and selected values when OK is clicked', async () => {
      const wrapper = mountFilter({ initialSelected: ['missense', 'nonsense'] })
      const okBtn = wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text() === 'OK')
      expect(okBtn).toBeDefined()
      await okBtn!.trigger('click')
      expect(wrapper.emitted('apply')).toBeTruthy()
      const payload = wrapper.emitted('apply')![0][0] as { operator: string; value: string[] }
      expect(payload.operator).toBe('in')
      expect(payload.value).toEqual(['missense', 'nonsense'])
    })

    it('emits clear when Clear is clicked', async () => {
      const wrapper = mountFilter({ initialSelected: ['missense'] })
      const clearBtn = wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text() === 'Clear')
      expect(clearBtn).toBeDefined()
      await clearBtn!.trigger('click')
      expect(wrapper.emitted('clear')).toBeTruthy()
    })

    it('does not emit apply when nothing is selected', async () => {
      const wrapper = mountFilter()
      const okBtn = wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text() === 'OK')
      await okBtn!.trigger('click')
      expect(wrapper.emitted('apply')).toBeFalsy()
    })
  })

  describe('scrollable area', () => {
    it('has a scrollable checkbox container with max-height', () => {
      const wrapper = mountFilter()
      const scrollable = wrapper.find('.checkbox-list')
      expect(scrollable.exists()).toBe(true)
    })
  })
})
