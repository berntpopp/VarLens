/** The filter-drawer multi-select is one valid combobox (axe aria-required-attr). */
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import GroupedMultiSelect from '../../../src/renderer/src/components/GroupedMultiSelect.vue'
import { consequenceGroups } from '../../../src/renderer/src/config/filterGroups'

const vuetify = createVuetify({ components, directives })

describe('GroupedMultiSelect', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('only the input is the combobox, and it carries aria-expanded', () => {
    const wrapper = mount(GroupedMultiSelect, {
      props: { config: consequenceGroups, modelValue: [], label: 'Consequence' },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    const comboboxes = wrapper.findAll('[role="combobox"]')
    expect(comboboxes).toHaveLength(1)
    expect(comboboxes[0].element).toBe(wrapper.get('input').element)
    expect(comboboxes[0].attributes('aria-expanded')).toBe('false')
  })
})
