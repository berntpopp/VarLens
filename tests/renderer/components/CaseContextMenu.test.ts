/**
 * Case-list context menu dismissal against real Vuetify.
 *
 * Vuetify only closes an overlay on Escape once it has flagged it as the
 * top-most one, and it sets that flag from a `setTimeout` after the open has
 * been flushed (`useStack`). An Escape that lands in that gap is dropped by
 * Vuetify and the menu stays open (issue #452). Fake timers hold the gap open
 * so the fast open -> Escape sequence is deterministic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import CaseContextMenu from '../../../src/renderer/src/components/CaseContextMenu.vue'

const vuetify = createVuetify({ components, directives })

interface MenuApi {
  openFromKeyboard: (event: KeyboardEvent) => boolean
}

function focusedCaseItem(): HTMLElement {
  const item = document.createElement('div')
  item.tabIndex = 0
  document.body.appendChild(item)
  item.focus()
  return item
}

function pressContextMenuKey(wrapper: VueWrapper, item: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key: 'ContextMenu', cancelable: true })
  Object.defineProperty(event, 'currentTarget', { value: item })
  ;(wrapper.vm as unknown as MenuApi).openFromKeyboard(event)
}

function pressEscape(): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

function isOpen(wrapper: VueWrapper): boolean {
  return wrapper.findComponent(components.VMenu).props('modelValue') === true
}

describe('CaseContextMenu Escape dismissal', () => {
  let wrapper: VueWrapper

  beforeEach(async () => {
    vi.useFakeTimers()
    // happy-dom has no hit-testing; Vuetify's reposition scroll strategy calls it.
    Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true })
    wrapper = mount(CaseContextMenu, {
      props: { multiSelectMode: false, selectedCount: 0 },
      global: { plugins: [vuetify] },
      attachTo: document.body
    })
    // Let the closed overlay settle: Vuetify clears its initial top-most flag from a timer.
    await vi.runAllTimersAsync()
  })

  afterEach(() => {
    wrapper.unmount()
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'elementsFromPoint')
    document.body.innerHTML = ''
  })

  it('closes on Escape once the menu has settled', async () => {
    pressContextMenuKey(wrapper, focusedCaseItem())
    await nextTick()
    await vi.runAllTimersAsync()
    expect(isOpen(wrapper)).toBe(true)

    pressEscape()
    await nextTick()
    expect(isOpen(wrapper)).toBe(false)
  })

  it('closes on an Escape that arrives right after reopening, before the overlay settles', async () => {
    const item = focusedCaseItem()
    pressContextMenuKey(wrapper, item)
    await nextTick()
    await vi.runAllTimersAsync()
    pressEscape()
    await nextTick()
    await vi.runAllTimersAsync()
    expect(isOpen(wrapper)).toBe(false)

    // Reopen and press Escape before any timer has run: Vuetify has not yet
    // marked the overlay top-most, so its own Escape handler ignores the key.
    pressContextMenuKey(wrapper, item)
    await nextTick()
    expect(isOpen(wrapper)).toBe(true)
    pressEscape()
    await nextTick()
    expect(isOpen(wrapper)).toBe(false)

    // It stays closed once Vuetify's deferred bookkeeping catches up.
    await vi.runAllTimersAsync()
    expect(isOpen(wrapper)).toBe(false)
  })

  it('closes on an Escape that arrives right after the very first open', async () => {
    pressContextMenuKey(wrapper, focusedCaseItem())
    await nextTick()
    pressEscape()
    await nextTick()
    expect(isOpen(wrapper)).toBe(false)
  })
})
