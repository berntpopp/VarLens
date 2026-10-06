import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { effectScope } from 'vue'
import {
  clampMenuPoint,
  isContextMenuKey,
  isKeyboardContextMenuEvent,
  pointFromElement,
  useContextMenu
} from '../../../src/renderer/src/composables/useContextMenu'

const VIEWPORT = { width: 1366, height: 768 }

function rectEl(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div')
  el.tabIndex = 0
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({})
    }) as DOMRect
  document.body.appendChild(el)
  return el
}

function mouseContextMenu(target: HTMLElement, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent('contextmenu', { clientX, clientY, button: 2, bubbles: true })
  Object.defineProperty(event, 'currentTarget', { value: target })
  return event
}

describe('clampMenuPoint', () => {
  it('keeps an in-viewport point unchanged (menu opens at the cursor)', () => {
    expect(clampMenuPoint([84, 264], VIEWPORT)).toEqual([84, 264])
  })

  it('clamps points outside the viewport to the margin', () => {
    expect(clampMenuPoint([-20, -5], VIEWPORT)).toEqual([8, 8])
    expect(clampMenuPoint([5000, 4000], VIEWPORT)).toEqual([1358, 760])
  })

  it('uses the given margin', () => {
    expect(clampMenuPoint([0, 0], VIEWPORT, 0)).toEqual([0, 0])
  })
})

describe('pointFromElement', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('anchors keyboard-opened menus inside the item, below its first line', () => {
    const el = rectEl({ left: 0, top: 240, width: 279, height: 48 })
    expect(pointFromElement(el, VIEWPORT)).toEqual([24, 264])
  })

  it('clamps an item that is partially scrolled out of view', () => {
    const el = rectEl({ left: 0, top: 750, width: 279, height: 48 })
    expect(pointFromElement(el, VIEWPORT)).toEqual([24, 760])
  })
})

describe('key / event classification', () => {
  it('recognises the ContextMenu key and Shift+F10 only', () => {
    expect(isContextMenuKey(new KeyboardEvent('keydown', { key: 'ContextMenu' }))).toBe(true)
    expect(isContextMenuKey(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }))).toBe(
      true
    )
    expect(isContextMenuKey(new KeyboardEvent('keydown', { key: 'F10' }))).toBe(false)
    expect(isContextMenuKey(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
  })

  it('treats a contextmenu event without pointer coordinates as keyboard-originated', () => {
    expect(isKeyboardContextMenuEvent(new MouseEvent('contextmenu', { button: 0 }))).toBe(true)
    expect(
      isKeyboardContextMenuEvent(
        new MouseEvent('contextmenu', { button: 2, clientX: 50, clientY: 250 })
      )
    ).toBe(false)
  })
})

describe('useContextMenu', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: VIEWPORT.width, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: VIEWPORT.height, configurable: true })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('opens at the mouse position in client (viewport) coordinates', () => {
    const menu = useContextMenu()
    const item = rectEl({ left: 0, top: 240, width: 279, height: 48 })
    menu.open(mouseContextMenu(item, 84, 264))
    expect(menu.show.value).toBe(true)
    expect(menu.target.value).toEqual([84, 264])
  })

  it('opens at the focused item for Shift+F10 and ignores the follow-up contextmenu event', () => {
    const menu = useContextMenu()
    const item = rectEl({ left: 0, top: 288, width: 279, height: 48 })
    const key = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, cancelable: true })
    Object.defineProperty(key, 'currentTarget', { value: item })

    expect(menu.openFromKeyboard(key)).toBe(true)
    expect(key.defaultPrevented).toBe(true)
    expect(menu.target.value).toEqual([24, 312])

    // Browsers also synthesise a contextmenu event for the same key press.
    menu.open(mouseContextMenu(item, 400, 400))
    expect(menu.target.value).toEqual([24, 312])
  })

  it('does not react to unrelated keys', () => {
    const menu = useContextMenu()
    const key = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
    expect(menu.openFromKeyboard(key)).toBe(false)
    expect(menu.show.value).toBe(false)
    expect(key.defaultPrevented).toBe(false)
  })

  it('returns focus to the invoking item when the menu closes', () => {
    const menu = useContextMenu()
    const item = rectEl({ left: 0, top: 240, width: 279, height: 48 })
    menu.open(mouseContextMenu(item, 84, 264))
    document.body.focus()
    menu.close()
    menu.restoreFocus()
    expect(document.activeElement).toBe(item)
  })

  it('closes on Escape immediately after opening, with no tick or timer in between', () => {
    const menu = useContextMenu()
    const item = rectEl({ left: 0, top: 240, width: 279, height: 48 })
    menu.open(mouseContextMenu(item, 84, 264))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(menu.show.value).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menu.show.value).toBe(false)
  })

  it('listens for Escape only while open, however the menu was closed', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const keydownCalls = (spy: typeof add | typeof remove) =>
      spy.mock.calls.filter(([type]) => type === 'keydown')

    const menu = useContextMenu()
    expect(keydownCalls(add)).toHaveLength(0)

    const item = rectEl({ left: 0, top: 240, width: 279, height: 48 })
    menu.open(mouseContextMenu(item, 84, 264))
    expect(keydownCalls(add)).toHaveLength(1)
    const listener = keydownCalls(add)[0][1]

    // Closed through the v-model (Vuetify: outside click, item click, its own Escape).
    menu.show.value = false
    expect(keydownCalls(remove).map(([, fn]) => fn)).toEqual([listener])

    add.mockRestore()
    remove.mockRestore()
  })

  it('stops listening when its owning scope is disposed while open', () => {
    const scope = effectScope()
    const menu = scope.run(() => useContextMenu())!
    const item = rectEl({ left: 0, top: 240, width: 279, height: 48 })
    menu.open(mouseContextMenu(item, 84, 264))
    scope.stop()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menu.show.value).toBe(true)
  })
})
