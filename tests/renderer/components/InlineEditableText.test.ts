import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import InlineEditableText from '../../../src/renderer/src/components/InlineEditableText.vue'
import { COMMENT_PLACEHOLDERS } from '../../../src/renderer/src/config/commentConfig'

const vuetify = createVuetify({ components, directives })

function mountEditor() {
  const save = vi.fn(async () => true)
  const wrapper = mount(InlineEditableText, {
    props: { modelValue: 'old', save },
    global: { plugins: [vuetify] },
    attachTo: document.body
  })
  return { wrapper, save }
}

describe('InlineEditableText', () => {
  it('discards the draft on Escape, even when the unmount blur follows', async () => {
    const { wrapper, save } = mountEditor()
    await wrapper.find('.editable-text').trigger('click')
    const textarea = wrapper.find('textarea')
    await textarea.setValue('discard me')
    await textarea.trigger('keydown', { key: 'Escape' })
    await textarea.trigger('blur')
    expect(save).not.toHaveBeenCalled()
    expect(wrapper.find('textarea').exists()).toBe(false)
    wrapper.unmount()
  })

  it('saves on blur', async () => {
    const { wrapper, save } = mountEditor()
    await wrapper.find('.editable-text').trigger('click')
    await wrapper.find('textarea').setValue('new')
    await wrapper.find('textarea').trigger('blur')
    expect(save).toHaveBeenCalledWith('new')
    wrapper.unmount()
  })

  it.each(['Enter', ' '])('starts editing from the keyboard (%j)', async (key) => {
    const { wrapper } = mountEditor()
    const trigger = wrapper.find('.editable-text')
    expect(trigger.attributes('tabindex')).toBe('0')
    expect(trigger.attributes('role')).toBe('button')
    await trigger.trigger('keydown', { key })
    expect(wrapper.find('textarea').exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the configured default placeholder, which does not assume a mouse', () => {
    const wrapper = mount(InlineEditableText, {
      props: { modelValue: null },
      global: { plugins: [vuetify] }
    })
    expect(wrapper.text()).toBe(COMMENT_PLACEHOLDERS.default)
    for (const text of Object.values(COMMENT_PLACEHOLDERS)) expect(text).not.toMatch(/click/i)
  })

  it.each(['Enter', ' '])('keeps %j from reaching window shortcuts (table Enter)', async (key) => {
    const { wrapper } = mountEditor()
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    await wrapper.find('.editable-text').trigger('keydown', { key })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps Escape from reaching window shortcuts (panel close) and returns focus', async () => {
    const { wrapper } = mountEditor()
    await wrapper.find('.editable-text').trigger('click')
    const onWindowKey = vi.fn()
    window.addEventListener('keydown', onWindowKey)
    await wrapper.find('textarea').trigger('keydown', { key: 'Escape' })
    window.removeEventListener('keydown', onWindowKey)
    expect(onWindowKey).not.toHaveBeenCalled()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.find('.editable-text').element)
    wrapper.unmount()
  })
})
