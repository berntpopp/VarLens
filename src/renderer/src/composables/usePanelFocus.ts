/**
 * Focus management for non-modal side panels (WCAG 2.4.3 Focus Order).
 *
 * On open, focus moves to the panel heading so screen-reader and keyboard
 * users land in the new content. On close, focus returns to whatever opened
 * the panel; when that was a mouse click on a non-focusable row (focus still
 * on <body>), it returns to the selected row instead.
 */
import { nextTick, watch, type Ref } from 'vue'

export const SELECTED_ROW_SELECTOR = 'tr.variant-row--selected'

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function focusableOpener(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return null
  return active
}

export function usePanelFocus(
  isOpen: () => boolean,
  heading: Ref<HTMLElement | null>,
  fallbackSelector: string = SELECTED_ROW_SELECTOR
): void {
  let opener: HTMLElement | null = null

  watch(isOpen, async (open, wasOpen) => {
    if (open && !wasOpen) {
      opener = focusableOpener()
      await nextTick()
      heading.value?.focus({ preventScroll: true })
      return
    }
    if (!open && wasOpen) {
      const row = document.querySelector<HTMLElement>(fallbackSelector)
      // A click on a (non-focusable) row leaves focus on its container, e.g.
      // <main>; prefer the row itself in that case.
      const openerUsable = opener?.isConnected === true && !(row && opener.contains(row))
      const target = openerUsable ? opener : (row ?? opener)
      opener = null
      // Closing clears the table selection, and the row re-render that drops
      // its tabindex lands after this tick; focus once rendering has settled and
      // keep the originating row programmatically focusable.
      await nextTick()
      await nextFrame()
      if (target && target === row && !target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1')
      }
      target?.focus({ preventScroll: true })
    }
  })
}
