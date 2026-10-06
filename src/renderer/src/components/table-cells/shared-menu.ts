/**
 * State for one `<v-menu>` shared by every row of a table.
 *
 * Rows render a plain button and call `toggle(button, payload)`; the table
 * renders a single v-menu bound to `open` / `activator` (with
 * `:open-on-click="false"`, since the buttons own the click) and reads the
 * row-specific data from `payload`.
 */
import { ref, shallowRef, type Ref, type ShallowRef } from 'vue'

export interface SharedMenu<T> {
  open: Ref<boolean>
  activator: ShallowRef<HTMLElement | null>
  payload: ShallowRef<T | null>
  /** Open for this row's button, or close when the same button is used again. */
  toggle: (activator: HTMLElement, payload: T) => void
  isOpenFor: (element: HTMLElement | null | undefined) => boolean
}

export function useSharedMenu<T>(): SharedMenu<T> {
  const open = ref(false)
  const activator = shallowRef<HTMLElement | null>(null)
  const payload = shallowRef<T | null>(null)

  function toggle(element: HTMLElement, next: T): void {
    if (open.value && activator.value === element) {
      open.value = false
      return
    }
    const switching = open.value
    activator.value = element
    payload.value = next
    if (!switching) {
      open.value = true
      return
    }
    // Moving from one row's button to another's while open: the overlay's
    // click-outside handler for this same click runs in a later task and
    // would close the menu again, so reopen after it has run.
    open.value = false
    setTimeout(() => {
      if (activator.value === element) open.value = true
    }, 0)
  }

  function isOpenFor(element: HTMLElement | null | undefined): boolean {
    return open.value && element != null && activator.value === element
  }

  return { open, activator, payload, toggle, isOpenFor }
}
