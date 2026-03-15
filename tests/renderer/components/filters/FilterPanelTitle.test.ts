import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import { VExpansionPanels, VExpansionPanel } from 'vuetify/components'
import FilterPanelTitle from '../../../../src/renderer/src/components/filters/FilterPanelTitle.vue'

const vuetify = createVuetify()

/**
 * FilterPanelTitle is a v-expansion-panel-title and must be wrapped in
 * v-expansion-panels > v-expansion-panel for Vuetify to render it correctly.
 */
function mountTitle(props: Record<string, unknown>) {
  const wrapper = mount(VExpansionPanels, {
    props: { multiple: true },
    slots: {
      default: {
        components: { VExpansionPanel, FilterPanelTitle },
        template: `
          <v-expansion-panel value="test">
            <FilterPanelTitle v-bind="titleProps" />
          </v-expansion-panel>
        `,
        setup() {
          return {
            titleProps: { icon: 'mdi-earth', label: 'Frequency', active: false, ...props }
          }
        }
      }
    },
    global: {
      plugins: [vuetify]
    }
  })
  return wrapper
}

describe('FilterPanelTitle', () => {
  it('renders label and icon', () => {
    const wrapper = mountTitle({})
    expect(wrapper.text()).toContain('Frequency')
  })

  it('shows Active chip when active', () => {
    const wrapper = mountTitle({ active: true })
    expect(wrapper.text()).toContain('Active')
  })

  it('does not show Active chip when inactive', () => {
    const wrapper = mountTitle({ active: false })
    expect(wrapper.text()).not.toContain('Active')
  })

  it('shows valueSummary when provided and active', () => {
    const wrapper = mountTitle({ active: true, valueSummary: '<= 1%' })
    expect(wrapper.text()).toContain('<= 1%')
  })

  it('does not show valueSummary when not active', () => {
    const wrapper = mountTitle({ active: false, valueSummary: '<= 1%' })
    expect(wrapper.text()).not.toContain('<= 1%')
  })

  it('does not show valueSummary when empty string', () => {
    const wrapper = mountTitle({ active: true, valueSummary: '' })
    const summaryEl = wrapper.find('.filter-value-summary')
    expect(summaryEl.exists()).toBe(false)
  })
})
