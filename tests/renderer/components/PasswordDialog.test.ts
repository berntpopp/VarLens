import { describe, it, expect } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import PasswordDialog from '../../../src/renderer/src/components/PasswordDialog.vue'

const vuetify = createVuetify({ components, directives })

async function submitWith(onSubmit: () => Promise<{ success: boolean; error?: string }>) {
  const wrapper = mount(PasswordDialog, { global: { plugins: [vuetify] }, attachTo: document.body })
  wrapper.vm.show(onSubmit)
  await nextTick()
  const ok = wrapper.findAllComponents({ name: 'VBtn' }).find((button) => button.text() === 'OK')
  await ok!.trigger('click')
  await flushPromises()
  const field = wrapper.findComponent({ name: 'VTextField' })
  return { wrapper, errorMessages: field.props('errorMessages') }
}

describe('PasswordDialog', () => {
  it('shows the message of an open that throws', async () => {
    const { wrapper, errorMessages } = await submitWith(async () => {
      throw new Error('The database file is damaged.')
    })
    expect(errorMessages).toBe('The database file is damaged.')
    wrapper.unmount()
  })

  it('still shows a reported failure as before', async () => {
    const { wrapper, errorMessages } = await submitWith(async () => ({
      success: false,
      error: 'WRONG_PASSWORD'
    }))
    expect(errorMessages).toBe('Incorrect password. Please try again.')
    wrapper.unmount()
  })
})
