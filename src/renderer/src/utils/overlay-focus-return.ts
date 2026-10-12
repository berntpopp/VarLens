/**
 * Returns focus to where it was when a dialog or menu closes (WCAG 2.4.3).
 *
 * Vuetify restores focus only to an overlay's activator; dialogs opened from a
 * menu item or a shortcut have none, so focus fell to <body>. One window-level
 * listener remembers the last focused element outside any overlay and, when
 * focus leaves an overlay for nowhere, puts it back once no dialog or menu is open.
 */

import { isPopupOpen } from '../composables/useTableKeyboardNav'

const OVERLAY_SELECTOR = '.v-overlay'

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** Install once at application start; returns a function that removes it. */
export function installOverlayFocusReturn(): () => void {
  let lastOutside: HTMLElement | null = null

  function onFocusIn(event: FocusEvent): void {
    const target = event.target
    if (target instanceof HTMLElement && target.closest(OVERLAY_SELECTOR) === null) {
      lastOutside = target
    }
  }

  function onFocusOut(event: FocusEvent): void {
    const target = event.target
    if (!(target instanceof HTMLElement) || target.closest(OVERLAY_SELECTOR) === null) return
    if (event.relatedTarget !== null) return
    const restore = lastOutside
    void nextFrame().then(() => {
      const active = document.activeElement
      if (active !== null && active !== document.body) return
      // Only an open dialog or menu keeps focus; a toast or tooltip is also a .v-overlay
      if (isPopupOpen()) return
      if (restore?.isConnected === true) restore.focus({ preventScroll: true })
    })
  }

  window.addEventListener('focusin', onFocusIn, true)
  window.addEventListener('focusout', onFocusOut, true)
  return () => {
    window.removeEventListener('focusin', onFocusIn, true)
    window.removeEventListener('focusout', onFocusOut, true)
  }
}
