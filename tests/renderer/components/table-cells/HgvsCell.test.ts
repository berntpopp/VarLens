import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import HgvsCell from '../../../../src/renderer/src/components/table-cells/HgvsCell.vue'

const vuetify = createVuetify({ components, directives })

describe('HgvsCell', () => {
  it('renders HGVS notation with notation class and tooltip', () => {
    const wrapper = mount(HgvsCell, {
      props: {
        value: 'c.123A>G (p.Lys41Arg)'
      },
      global: {
        plugins: [vuetify]
      }
    })

    expect(wrapper.text()).toContain('c.123A>G (p.Lys41Arg)')
    expect(wrapper.find('.hgvs-notation').exists()).toBe(true)
    expect(wrapper.find('.hgvs-notation').text()).toBe('c.123A>G (p.Lys41Arg)')
  })

  it('renders fallback EmptyPlaceholder when value is empty or null', () => {
    const wrapper = mount(HgvsCell, {
      props: {
        value: ''
      },
      global: {
        plugins: [vuetify]
      }
    })

    expect(wrapper.text()).toBe('--')
    expect(wrapper.find('.hgvs-notation').exists()).toBe(false)
  })
})
