import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

import SetRecoveryPassphraseDialog from '../../../src/renderer/src/components/SetRecoveryPassphraseDialog.vue'
import { useDatabaseStore } from '../../../src/renderer/src/stores/databaseStore'

const vuetify = createVuetify({ components, directives })

describe('SetRecoveryPassphraseDialog', () => {
  let wrapper: VueWrapper<InstanceType<typeof SetRecoveryPassphraseDialog>>

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('surfaces a portable-sidecar partial failure and keeps the dialog open', async () => {
    const store = useDatabaseStore()
    store.setRecoveryPassphrase = vi.fn().mockResolvedValue({
      success: true,
      recoveryPassphraseSet: true,
      sidecarWritten: false
    })
    wrapper = mount(SetRecoveryPassphraseDialog, {
      global: { plugins: [vuetify] },
      attachTo: document.body
    })

    wrapper.vm.show()
    await wrapper.vm.$nextTick()
    await flushPromises()
    const inputs = Array.from(document.body.querySelectorAll('input'))
    expect(inputs).toHaveLength(2)
    for (const input of inputs) {
      input.value = 'correct horse battery staple'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const submit = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Set Recovery Passphrase')
    )
    expect(submit).toBeDefined()
    submit?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(document.body.textContent).toMatch(/portable recovery.*failed/i)
    expect(document.body.textContent).toContain('Set Recovery Passphrase')
    expect(wrapper.emitted('recovery-passphrase-set')).toBeUndefined()
  })
})
