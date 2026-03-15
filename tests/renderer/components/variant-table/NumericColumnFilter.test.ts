import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import NumericColumnFilter from '../../../../src/renderer/src/components/variant-table/NumericColumnFilter.vue'
import type { ColumnFilterOperator } from '../../../../src/shared/types/column-filters'

const vuetify = createVuetify({ components, directives })

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(NumericColumnFilter, {
    props: { columnTitle: 'CADD Score', ...props },
    global: { plugins: [vuetify] }
  })
}

describe('NumericColumnFilter', () => {
  describe('rendering', () => {
    it('renders a v-card with the column title', () => {
      const wrapper = mountFilter()
      const card = wrapper.find('.v-card')
      expect(card.exists()).toBe(true)
      expect(wrapper.text()).toContain('CADD Score')
    })

    it('renders operator select with all numeric operators', () => {
      const wrapper = mountFilter()
      const select = wrapper.findComponent({ name: 'VSelect' })
      expect(select.exists()).toBe(true)
    })

    it('renders a number text field', () => {
      const wrapper = mountFilter()
      const textField = wrapper.findComponent({ name: 'VTextField' })
      expect(textField.exists()).toBe(true)
    })

    it('shows range hint when min and max are provided', () => {
      const wrapper = mountFilter({ min: 0, max: 50 })
      expect(wrapper.text()).toContain('0')
      expect(wrapper.text()).toContain('50')
    })

    it('does not show range hint when min/max are not provided', () => {
      const wrapper = mountFilter()
      expect(wrapper.text()).not.toContain('Range:')
    })

    it('renders Clear and Apply buttons', () => {
      const wrapper = mountFilter()
      const buttons = wrapper.findAllComponents({ name: 'VBtn' })
      const buttonTexts = buttons.map((b) => b.text())
      expect(buttonTexts).toContain('Clear')
      expect(buttonTexts).toContain('Apply')
    })
  })

  describe('initial values', () => {
    it('uses initialOperator when provided', () => {
      const wrapper = mountFilter({ initialOperator: '>=' as ColumnFilterOperator })
      const select = wrapper.findComponent({ name: 'VSelect' })
      expect(select.props('modelValue')).toBe('>=')
    })

    it('uses initialValue when provided', () => {
      const wrapper = mountFilter({ initialValue: 25 })
      // Find standalone VTextField (not the one inside VSelect)
      const textFields = wrapper.findAllComponents({ name: 'VTextField' })
      const valueField = textFields.find((tf) => tf.props('type') === 'number')
      expect(valueField).toBeDefined()
      expect(valueField!.props('modelValue')).toBe(25)
    })

    it('defaults operator to = when not provided', () => {
      const wrapper = mountFilter()
      const select = wrapper.findComponent({ name: 'VSelect' })
      expect(select.props('modelValue')).toBe('=')
    })
  })

  describe('events', () => {
    it('emits apply with operator and value when Apply is clicked', async () => {
      const wrapper = mountFilter({
        initialOperator: '>' as ColumnFilterOperator,
        initialValue: 20
      })
      const applyBtn = wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text() === 'Apply')
      expect(applyBtn).toBeDefined()
      await applyBtn!.trigger('click')
      expect(wrapper.emitted('apply')).toBeTruthy()
      expect(wrapper.emitted('apply')![0]).toEqual([
        { operator: '>', value: 20, includeEmpty: true }
      ])
    })

    it('emits clear when Clear is clicked', async () => {
      const wrapper = mountFilter()
      const clearBtn = wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text() === 'Clear')
      expect(clearBtn).toBeDefined()
      await clearBtn!.trigger('click')
      expect(wrapper.emitted('clear')).toBeTruthy()
    })

    it('does not emit apply when value is empty', async () => {
      const wrapper = mountFilter()
      const applyBtn = wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text() === 'Apply')
      await applyBtn!.trigger('click')
      expect(wrapper.emitted('apply')).toBeFalsy()
    })
  })
})
