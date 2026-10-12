import { describe, it, expect, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import KeyboardShortcutsDialog from '@renderer/components/KeyboardShortcutsDialog.vue'
import { SHORTCUT_GROUPS } from '@renderer/config/keyboardShortcuts'

const vuetify = createVuetify()

describe('KeyboardShortcutsDialog', () => {
  let wrapper: VueWrapper

  afterEach(() => {
    wrapper?.unmount()
  })

  function mountDialog() {
    wrapper = mount(KeyboardShortcutsDialog, {
      props: { modelValue: true },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    // Vuetify dialogs teleport to body, so query document.body
    return document.body
  }

  it('renders when modelValue is true', () => {
    const body = mountDialog()
    const text = body.textContent ?? ''

    expect(text).toContain('Keyboard Shortcuts')
    expect(text).toContain('Table Navigation')
    expect(text).toContain('Actions')
  })

  it('shows all shortcut groups', () => {
    const body = mountDialog()
    const text = body.textContent ?? ''

    expect(text).toContain('Table Navigation')
    expect(text).toContain('Actions (on selected row)')
    expect(text).toContain('Search & Filters')
    expect(text).toContain('General')
  })

  it('includes key shortcuts in kbd elements', () => {
    mountDialog()
    const kbds = document.body.querySelectorAll('kbd')
    expect(kbds.length).toBeGreaterThan(0)
  })

  it('lists every shortcut of the shared list, so dialog and tooltip hints cannot drift', () => {
    mountDialog()
    const rows = [...document.body.querySelectorAll('tbody tr')].map((tr) => tr.textContent ?? '')
    const expected = SHORTCUT_GROUPS.flatMap((g) => g.shortcuts.map((s) => s.key + s.description))
    expect(rows).toEqual(expected)
  })

  it('lists p for the protein view', () => {
    mountDialog()
    const rows = [...document.body.querySelectorAll('tr')].map((tr) => tr.textContent ?? '')
    expect(rows.some((t) => t.startsWith('p') && t.includes('protein view'))).toBe(true)
  })
})
