import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import CommandPalette, { type PaletteExtraCommand } from '@renderer/components/CommandPalette.vue'
import { SHORTCUTS } from '@renderer/config/keyboardShortcuts'

const vuetify = createVuetify()

async function mountPalette(
  actions: Record<string, () => void>,
  extraCommands?: ReadonlyArray<PaletteExtraCommand>
) {
  const wrapper = mount(CommandPalette, {
    props: {
      modelValue: true,
      actions,
      extraCommands,
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

  it('lists and executes extraCommands alongside shortcuts, omitting <kbd> when key is unset', async () => {
    const switchView = vi.fn()
    const applyPreset = vi.fn()
    await mountPalette({ help: vi.fn() }, [
      { id: 'nav:switch-view', description: 'Switch to Cohort view', action: switchView },
      {
        id: 'preset:1',
        description: 'Apply preset: Rare Coding',
        key: 'P1',
        action: applyPreset
      }
    ])

    const rows = options().map((el) => el.textContent ?? '')
    expect(rows).toEqual([
      SHORTCUTS.help.description + SHORTCUTS.help.key,
      'Switch to Cohort view',
      'Apply preset: Rare CodingP1'
    ])

    const input = document.body.querySelector('input')!
    input.value = 'Cohort view'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(switchView).toHaveBeenCalledTimes(1)
    expect(applyPreset).not.toHaveBeenCalled()
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

  it('Tab never runs a command; Enter runs the first match', async () => {
    const faq = vi.fn()
    await mountPalette({ help: vi.fn(), faq })
    const input = document.body.querySelector('input')!
    input.value = SHORTCUTS.faq.description
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    await flushPromises()
    expect(faq).not.toHaveBeenCalled()

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(faq).toHaveBeenCalledTimes(1)
  })

  it('says so when no command matches', async () => {
    await mountPalette({ help: vi.fn() })
    const input = document.body.querySelector('input')!
    input.value = 'zzz-no-such-command'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('No matching commands')
  })

  it('closes on Escape', async () => {
    const wrapper = await mountPalette({ help: vi.fn() })
    document.body
      .querySelector('input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })
})
