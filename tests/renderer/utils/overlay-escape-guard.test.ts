/**
 * Escape dismissal of Vuetify overlays (v-menu, v-dialog, and the dropdowns
 * Vuetify builds from them) against real Vuetify.
 *
 * Vuetify decides "am I the top-most overlay?" from a flag it only updates in
 * a `setTimeout` after the overlay stack changed (`useStack`). Until that
 * timer runs, the flags describe the previous stack: an Escape is dropped by
 * the overlay that just opened, or closes the dialog underneath a menu that
 * just opened (issue #452 fixed this for the case context menu only).
 *
 * Fake timers hold that window open. Every scenario renders the overlay first
 * (`nextTick`) — the state a real key press finds — and sends Escape before
 * any timer has run.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { installOverlayEscapeGuard } from '../../../src/renderer/src/utils/overlay-escape-guard'

const vuetify = createVuetify({ components, directives })
const { VMenu, VDialog, VCard, VList } = components

interface Host {
  wrapper: VueWrapper
  menu: Ref<boolean>
  dialog: Ref<boolean>
}

/** A dialog that contains a menu, both driven by plain refs like in the app. */
function mountHost(options: { persistentDialog?: boolean } = {}): Host {
  const menu = ref(false)
  const dialog = ref(false)
  const HostComponent = defineComponent({
    setup() {
      const menuNode = () =>
        h(
          VMenu,
          { modelValue: menu.value, 'onUpdate:modelValue': (v: boolean) => (menu.value = v) },
          { default: () => h(VList, null, { default: () => 'menu content' }) }
        )
      return () =>
        h('div', [
          h(
            VDialog,
            {
              modelValue: dialog.value,
              'onUpdate:modelValue': (v: boolean) => (dialog.value = v),
              persistent: options.persistentDialog === true
            },
            { default: () => h(VCard, null, { default: () => ['dialog content', menuNode()] }) }
          ),
          // Outside a dialog the menu is rendered on its own.
          dialog.value ? null : menuNode()
        ])
    }
  })
  const wrapper = mount(HostComponent, { global: { plugins: [vuetify] }, attachTo: document.body })
  return { wrapper, menu, dialog }
}

function pressEscape(target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('overlay Escape guard', () => {
  let host: Host
  let uninstall: (() => void) | null

  async function open(flag: Ref<boolean>): Promise<void> {
    flag.value = true
    // Rendered, but Vuetify's stack timer has not run: the window a fast key press hits.
    await nextTick()
  }

  async function settle(): Promise<void> {
    await nextTick()
    await vi.runAllTimersAsync()
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    // happy-dom has no hit-testing; Vuetify's reposition scroll strategy calls it.
    Object.defineProperty(document, 'elementsFromPoint', { value: () => [], configurable: true })
    uninstall = null
    host = mountHost()
    await settle()
  })

  afterEach(() => {
    uninstall?.()
    host.wrapper.unmount()
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'elementsFromPoint')
    document.body.innerHTML = ''
  })

  describe('without the guard (the Vuetify behaviour it exists for)', () => {
    // These pin the upstream defect. If one turns red after a Vuetify upgrade,
    // Vuetify fixed the race and the guard can be retired.
    it('a menu ignores an Escape that arrives before its stack timer', async () => {
      await open(host.menu)
      pressEscape()
      await settle()
      expect(host.menu.value).toBe(true)
    })

    it('a dialog ignores an Escape that arrives before its stack timer', async () => {
      await open(host.dialog)
      pressEscape()
      await settle()
      expect(host.dialog.value).toBe(true)
    })

    it('Escape right after opening a menu in a dialog closes the dialog instead', async () => {
      await open(host.dialog)
      await settle()
      await open(host.menu)
      pressEscape()
      await settle()
      expect({ dialog: host.dialog.value, menu: host.menu.value }).toEqual({
        dialog: false,
        menu: true
      })
    })
  })

  describe('with the guard', () => {
    beforeEach(() => {
      uninstall = installOverlayEscapeGuard()
    })

    it('closes a menu on an Escape that arrives before its stack timer', async () => {
      await open(host.menu)
      pressEscape()
      await settle()
      expect(host.menu.value).toBe(false)
    })

    it('closes a dialog on an Escape that arrives before its stack timer', async () => {
      await open(host.dialog)
      pressEscape()
      await settle()
      expect(host.dialog.value).toBe(false)
    })

    it('still closes a settled overlay', async () => {
      await open(host.menu)
      await settle()
      pressEscape()
      await settle()
      expect(host.menu.value).toBe(false)
    })

    it('closes the menu, not the dialog under it, right after the menu opened', async () => {
      await open(host.dialog)
      await settle()
      await open(host.menu)
      pressEscape()
      await settle()
      expect({ dialog: host.dialog.value, menu: host.menu.value }).toEqual({
        dialog: true,
        menu: false
      })
    })

    it('two fast Escapes close the menu and then the dialog', async () => {
      await open(host.dialog)
      await settle()
      await open(host.menu)
      pressEscape()
      pressEscape()
      await settle()
      expect({ dialog: host.dialog.value, menu: host.menu.value }).toEqual({
        dialog: false,
        menu: false
      })
    })

    it('leaves a persistent dialog open', async () => {
      host.wrapper.unmount()
      host = mountHost({ persistentDialog: true })
      await settle()
      await open(host.dialog)
      pressEscape()
      await settle()
      expect(host.dialog.value).toBe(true)
    })

    it('delivers each Escape to other listeners exactly once', async () => {
      const seen: KeyboardEvent[] = []
      const listener = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') seen.push(event)
      }
      window.addEventListener('keydown', listener)
      try {
        await open(host.menu)
        pressEscape()
        expect(seen).toHaveLength(0)
        await settle()
        expect(seen).toHaveLength(1)
      } finally {
        window.removeEventListener('keydown', listener)
      }
    })

    it('replays the key on the element that had it, with its modifiers', async () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      const seen: KeyboardEvent[] = []
      input.addEventListener('keydown', (event) => seen.push(event))
      await open(host.menu)

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true })
      )
      await settle()

      // The original was held back at the window; only the replay reached the input.
      expect(seen).toHaveLength(1)
      expect(seen[0].shiftKey).toBe(true)
      expect(host.menu.value).toBe(false)
    })

    it('does not touch Escape while no overlay is open', () => {
      const seen: KeyboardEvent[] = []
      const listener = (event: KeyboardEvent): void => void seen.push(event)
      window.addEventListener('keydown', listener)
      try {
        const original = pressEscape()
        // Delivered synchronously, and it is the very same event.
        expect(seen).toEqual([original])
      } finally {
        window.removeEventListener('keydown', listener)
      }
    })

    it('does not touch other keys or IME composition', async () => {
      await open(host.menu)
      const seen: KeyboardEvent[] = []
      const listener = (event: KeyboardEvent): void => void seen.push(event)
      window.addEventListener('keydown', listener)
      try {
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
        document.body.dispatchEvent(enter)
        const composing = new KeyboardEvent('keydown', {
          key: 'Escape',
          isComposing: true,
          bubbles: true
        })
        document.body.dispatchEvent(composing)
        expect(seen).toEqual([enter, composing])
      } finally {
        window.removeEventListener('keydown', listener)
      }
    })

    it('stops intercepting once uninstalled', async () => {
      uninstall?.()
      uninstall = null
      await open(host.menu)
      pressEscape()
      await settle()
      expect(host.menu.value).toBe(true)
    })
  })
})
