import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import App from '../../src/renderer/src/App.vue'

const vuetify = createVuetify({ components, directives })

describe('App.vue', () => {
  it('renders Varlens title', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [vuetify]
      }
    })
    expect(wrapper.text()).toContain('Varlens')
  })

  it('uses Vuetify v-app component', () => {
    const wrapper = mount(App, {
      global: {
        plugins: [vuetify]
      }
    })
    expect(wrapper.find('.v-application').exists()).toBe(true)
  })
})
