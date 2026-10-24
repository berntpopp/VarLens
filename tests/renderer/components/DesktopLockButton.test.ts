import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createPinia, setActivePinia } from 'pinia'
import DesktopLockButton from '../../../src/renderer/src/components/auth/DesktopLockButton.vue'
import { useCapabilityStore } from '../../../src/renderer/src/stores/capabilityStore'
import { useDesktopAuthStore } from '../../../src/renderer/src/stores/desktopAuthStore'
import { computeCapabilityDocument } from '../../../src/shared/ipc/capability-document'

const vuetify = createVuetify({ components, directives })
type TestWindow = Window & { api?: unknown }

describe('DesktopLockButton', () => {
  const desktopLock = vi.fn(async () => undefined)

  beforeEach(async () => {
    setActivePinia(createPinia())
    ;(window as TestWindow).api = {
      system: {
        getCapabilities: () =>
          Promise.resolve(
            computeCapabilityDocument({ runtime: 'desktop', role: 'admin', storage: null })
          )
      },
      auth: { desktopLock }
    }
    await useCapabilityStore().load()
  })

  it('is hidden without a signed-in platform session', () => {
    const wrapper = mount(DesktopLockButton, { global: { plugins: [vuetify] } })
    expect(wrapper.find('[data-testid="desktop-lock"]').exists()).toBe(false)
  })

  it('locks a signed-in session', async () => {
    useDesktopAuthStore().status = {
      mode: 'platform',
      state: 'signed-in',
      issuer: 'https://keycloak.example.org'
    }
    const wrapper = mount(DesktopLockButton, { global: { plugins: [vuetify] } })
    await wrapper.find('[data-testid="desktop-lock"]').trigger('click')
    expect(desktopLock).toHaveBeenCalledOnce()
  })
})
