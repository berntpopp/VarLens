import { ref } from 'vue'

/** A viewport (client) coordinate pair, the shape Vuetify's `v-menu :target` accepts. */
export type ContextMenuPoint = [x: number, y: number]

interface ViewportSize {
  width: number
  height: number
}

/** Keep menus this far from the viewport edge when clamping. */
const VIEWPORT_MARGIN = 8
/** Keyboard-opened menus sit this far into the item, below its first text line. */
const ELEMENT_INSET_X = 24
const ELEMENT_INSET_Y = 24
/** Window in which a browser-synthesised `contextmenu` after Shift+F10 is ignored. */
const KEYBOARD_DEDUPE_MS = 500

function currentViewport(): ViewportSize {
  return { width: window.innerWidth, height: window.innerHeight }
}

/** Clamp a point so the menu anchor never sits outside the visible viewport. */
export function clampMenuPoint(
  [x, y]: ContextMenuPoint,
  viewport: ViewportSize,
  margin = VIEWPORT_MARGIN
): ContextMenuPoint {
  const clamp = (value: number, max: number): number =>
    Math.min(Math.max(value, margin), Math.max(margin, max - margin))
  return [clamp(x, viewport.width), clamp(y, viewport.height)]
}

/** Anchor point for a menu opened from the keyboard on a focused element. */
export function pointFromElement(el: Element, viewport: ViewportSize): ContextMenuPoint {
  const rect = el.getBoundingClientRect()
  const x = rect.left + Math.min(ELEMENT_INSET_X, rect.width / 2)
  const y = rect.top + Math.min(ELEMENT_INSET_Y, rect.height / 2)
  return clampMenuPoint([x, y], viewport)
}

/** The ContextMenu key or Shift+F10 — the platform keyboard gestures for a context menu. */
export function isContextMenuKey(event: KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}

/** A `contextmenu` raised by the keyboard has no secondary-button press behind it. */
export function isKeyboardContextMenuEvent(event: MouseEvent): boolean {
  return event.button !== 2
}

/**
 * State for a cursor-anchored context menu rendered with
 * `<v-menu :target="target" location="bottom start">`.
 *
 * `target` is in client coordinates, which is what Vuetify's connected
 * location strategy expects for a point target; it flips/shifts the menu to
 * stay inside the viewport. The invoking element is remembered so focus can
 * return to it when the menu closes.
 */
export function useContextMenu() {
  const show = ref(false)
  const target = ref<ContextMenuPoint>([0, 0])
  const openedByKeyboard = ref(false)
  let returnFocusEl: HTMLElement | null = null
  let keyboardOpenedAt = Number.NEGATIVE_INFINITY

  const openAt = (point: ContextMenuPoint, invoker: EventTarget | null, keyboard: boolean) => {
    target.value = point
    returnFocusEl = invoker instanceof HTMLElement ? invoker : null
    openedByKeyboard.value = keyboard
    show.value = true
  }

  const openAtElement = (el: EventTarget | null) => {
    if (!(el instanceof Element)) return
    openAt(pointFromElement(el, currentViewport()), el, true)
  }

  /** Handler for `@contextmenu.prevent` on the item. */
  const open = (event: MouseEvent) => {
    if (performance.now() - keyboardOpenedAt < KEYBOARD_DEDUPE_MS) return
    if (isKeyboardContextMenuEvent(event)) {
      openAtElement(event.currentTarget)
      return
    }
    openAt(
      clampMenuPoint([event.clientX, event.clientY], currentViewport()),
      event.currentTarget,
      false
    )
  }

  /** Handler for `@keydown` on the item; returns true when it opened the menu. */
  const openFromKeyboard = (event: KeyboardEvent): boolean => {
    if (!isContextMenuKey(event)) return false
    event.preventDefault()
    keyboardOpenedAt = performance.now()
    openAtElement(event.currentTarget)
    return true
  }

  const close = () => {
    show.value = false
  }

  /** Move focus back to the invoking item unless something else already took it. */
  const restoreFocus = (menuContent?: Element | null) => {
    const active = document.activeElement
    const focusIsAdrift =
      active === null ||
      active === document.body ||
      (menuContent != null && menuContent.contains(active))
    if (focusIsAdrift && returnFocusEl?.isConnected === true) {
      returnFocusEl.focus({ preventScroll: true })
    }
    returnFocusEl = null
  }

  return { show, target, openedByKeyboard, open, openFromKeyboard, close, restoreFocus }
}
