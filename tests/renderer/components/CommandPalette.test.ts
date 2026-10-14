import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import CommandPalette from '@renderer/components/CommandPalette.vue'
import { SHORTCUTS } from '@renderer/config/keyboardShortcuts'

const vuetify = createVuetify()

async function mountPalette(actions: Record<string, () => void>) {
  const wrapper = mount(CommandPalette, {
    props: {
      modelValue: true,
      actions,
      'onUpdate:modelValue': (open: boolean) => wrapper.setProps({ modelValue: open })
    },
    global: { plugins: [vuetify] },
    attachTo: document.body
  })
  await flushPromises()
  return wrapper
}

/** Teleported option rows of the open autocomplete menu. */
function options(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
}

describe('CommandPalette', () => {
  enableAutoUnmount(afterEach)
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('lists each shortcut with a wired action, with its key, and nothing else', async () => {
    await mountPalette({ help: vi.fn(), faq: vi.fn(), palette: vi.fn() })
    const rows = options().map((el) => el.textContent ?? '')
    expect(rows).toEqual([
      SHORTCUTS.help.description + SHORTCUTS.help.key,
      SHORTCUTS.faq.description + SHORTCUTS.faq.key
    ])
  })

  it('focuses the command input on open', async () => {
    await mountPalette({ help: vi.fn() })
    expect(document.activeElement).toBe(
      document.body.querySelector('[role="combobox"] input, input')
    )
  })

  it('runs the chosen action, closes, and returns focus', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const faq = vi.fn()
    const wrapper = await mountPalette({ help: vi.fn(), faq })

    options()
      .find((el) => el.textContent?.includes(SHORTCUTS.faq.description))!
      .click()
    await flushPromises()

    expect(faq).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape', async () => {
    const wrapper = await mountPalette({ help: vi.fn() })
    document.body
      .querySelector('input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })
})
