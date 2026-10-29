import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createPinia, setActivePinia } from 'pinia'
import DesktopSignIn from '../../../src/renderer/src/components/auth/DesktopSignIn.vue'
import { useDesktopAuthStore } from '../../../src/renderer/src/stores/desktopAuthStore'

const vuetify = createVuetify({ components, directives })

describe('DesktopSignIn', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('asks to sign in and names where', () => {
    useDesktopAuthStore().status = {
      mode: 'platform',
      state: 'locked',
      issuer: 'https://keycloak.example.org/realms/varlens'
    }
    const wrapper = mount(DesktopSignIn, { global: { plugins: [vuetify] } })
    expect(wrapper.find('[data-testid="desktop-sign-in-required"]').text()).toContain(
      'keycloak.example.org'
    )
    expect(wrapper.find('[data-testid="desktop-sign-in-problem"]').exists()).toBe(false)
  })

  it('explains a refused configuration', () => {
    useDesktopAuthStore().status = {
      mode: 'platform',
      state: 'misconfigured',
      problem: '/etc/varlens/auth.json is not owned by root'
    }
    const wrapper = mount(DesktopSignIn, { global: { plugins: [vuetify] } })
    const problem = wrapper.find('[data-testid="desktop-sign-in-problem"]')
    expect(problem.text()).toContain('not owned by root')
    expect(problem.text()).toContain('administrator')
  })
})
