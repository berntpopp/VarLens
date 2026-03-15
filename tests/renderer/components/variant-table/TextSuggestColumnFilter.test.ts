import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import TextSuggestColumnFilter from '../../../../src/renderer/src/components/variant-table/TextSuggestColumnFilter.vue'

const vuetify = createVuetify({ components, directives })

const sampleSuggestions = ['BRCA1', 'BRCA2', 'TP53', 'EGFR', 'KRAS']

function mountFilter(props: Record<string, unknown> = {}) {
  return mount(TextSuggestColumnFilter, {
    props: { columnTitle: 'Gene', suggestions: sampleSuggestions, ...props },
    global: { plugins: [vuetify] }
  })
}

describe('TextSuggestColumnFilter', () => {
  describe('rendering', () => {
    it('renders a v-card with the column title', () => {
      const wrapper = mountFilter()
      const card = wrapper.find('.v-card')
      expect(card.exists()).toBe(true)
      expect(wrapper.text()).toContain('Gene')
    })

    it('renders a v-autocomplete', () => {
      const wrapper = mountFilter()
      const autocomplete = wrapper.findComponent({ name: 'VAutocomplete' })
      expect(autocomplete.exists()).toBe(true)
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
    it('uses initialValue when provided', () => {
      const wrapper = mountFilter({ initialValue: 'BRCA1' })
      const autocomplete = wrapper.findComponent({ name: 'VAutocomplete' })
      expect(autocomplete.props('modelValue')).toBe('BRCA1')
    })

    it('starts empty when no initialValue', () => {
      const wrapper = mountFilter()
      const autocomplete = wrapper.findComponent({ name: 'VAutocomplete' })
      expect(autocomplete.props('modelValue')).toBe('')
    })
  })

  describe('events', () => {
    it('emits apply with like operator and value when Apply is clicked', async () => {
      const wrapper = mountFilter({ initialValue: 'BRCA1' })
      const applyBtn = wrapper.findAllComponents({ name: 'VBtn' }).find((b) => b.text() === 'Apply')
      expect(applyBtn).toBeDefined()
      await applyBtn!.trigger('click')
      expect(wrapper.emitted('apply')).toBeTruthy()
      expect(wrapper.emitted('apply')![0]).toEqual([{ operator: 'like', value: 'BRCA1' }])
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
