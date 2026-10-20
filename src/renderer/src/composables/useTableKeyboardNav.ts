import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'

export interface UseTableKeyboardNavOptions<T> {
  /** Reactive array of items currently displayed in the table */
  items: Ref<T[]>
  /** Extract unique ID from an item (for selectByClick lookup) */
  getItemId: (item: T) => string | number
  /** Called when a row is selected (by keyboard or click) */
  onSelect: (item: T) => void
}

export interface UseTableKeyboardNavReturn<T> {
  /** Index of selected row within current page, or null */
  selectedIndex: Ref<number | null>
  /** The selected item derived from selectedIndex, or null */
  selectedItem: ComputedRef<T | null>
  /** Select a row by index (clamped to valid range) */
  selectIndex: (index: number) => void
  /** Select a row by item reference (used for click handler integration) */
  selectByClick: (item: T) => void
  /** Move selection up one row */
  moveUp: () => void
  /** Move selection down one row */
  moveDown: () => void
  /** Clear selection */
  clearSelection: () => void
  /** Check if an input/textarea/contenteditable is currently focused */
  isInputFocused: () => boolean
}

/**
 * Check if a text-entry element (input/textarea/select/contenteditable) is
 * focused. Global app shortcuts (useKeyboardShortcuts) bail out only here.
 */
export function isTextEntryFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type?.toLowerCase()
    return type !== 'checkbox' && type !== 'button'
  }
  return el.getAttribute('contenteditable') === 'true'
}

/**
 * An open dialog or menu owns the keyboard. A menu opened by mouse leaves
 * focus on its activator, so this cannot be read from the focused element.
 */
export function isPopupOpen(): boolean {
  return document.querySelector('.v-dialog.v-overlay--active, .v-menu.v-overlay--active') !== null
}

/** A popup or a modal drawer (one with a scrim) owns the keyboard. */
export function isOverlayOpen(): boolean {
  return isPopupOpen() || document.querySelector('.v-navigation-drawer__scrim') !== null
}

/**
 * A focused button or link activates itself on Enter, so the row's Enter
 * (open the panel) must not take the key and cancel its click.
 */
export function isControlFocused(): boolean {
  return document.activeElement?.closest(CONTROL_SELECTOR) != null
}

const CONTROL_SELECTOR = 'button, a[href], [role="button"]'

// The control the last pointer press landed on. Chromium makes a mouse-focused
// button match :focus-visible once any key is pressed, so the focus source has
// to be recorded at the press, not read during the keydown.
let pointerFocusedControl: Element | null = null
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      pointerFocusedControl = (e.target as Element | null)?.closest?.(CONTROL_SELECTOR) ?? null
    },
    true
  )
}

/**
 * Table row shortcuts bail out on text entry, on an open dialog/menu and on a
 * focused link: a focused link cell owns Enter, so it must not also open the
 * row panel.
 */
export function isInputFocused(): boolean {
  if (isTextEntryFocused() || isOverlayOpen()) return true
  const el = document.activeElement
  return el !== null && el.tagName.toLowerCase() === 'a' && el.hasAttribute('href')
}

/**
 * True when Ctrl, Cmd or Alt is held. Bare-letter row shortcuts (s/c/a/e) must
 * bail out on these so Ctrl/Cmd+C (copy), +A (select all), +S (save), Ctrl+E
 * (browser search) etc. reach the browser instead of opening a dialog.
 */
export function hasCommandModifier(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey || e.altKey
}

export function useTableKeyboardNav<T>(
  options: UseTableKeyboardNavOptions<T>
): UseTableKeyboardNavReturn<T> {
  const { items, getItemId, onSelect } = options

  const selectedIndex = ref<number | null>(null) as Ref<number | null>

  const selectedItem = computed<T | null>(() => {
    if (selectedIndex.value === null) return null
    return items.value[selectedIndex.value] ?? null
  })

  function selectIndex(index: number): void {
    if (items.value.length === 0) return
    const clamped = Math.max(0, Math.min(index, items.value.length - 1))
    selectedIndex.value = clamped
    const item = items.value[clamped]
    if (item !== undefined) onSelect(item)
  }

  function selectByClick(item: T): void {
    const id = getItemId(item)
    const index = items.value.findIndex((i) => getItemId(i) === id)
    if (index !== -1) {
      selectedIndex.value = index
      onSelect(item)
    }
  }

  // ↑ / ↓ hand the keyboard back to the table: a button the mouse left focused
  // must not take the next Enter (isControlFocused) from the selected row.
  // Focus reached by keyboard (Tab) stays put so Tab users keep their place.
  function releaseControlFocus(): void {
    const el = document.activeElement as HTMLElement | null
    if (el && isControlFocused() && el === pointerFocusedControl) el.blur()
  }

  function moveDown(): void {
    releaseControlFocus()
    if (items.value.length === 0) return
    if (selectedIndex.value === null) {
      selectIndex(0)
    } else {
      selectIndex(selectedIndex.value + 1)
    }
  }

  function moveUp(): void {
    releaseControlFocus()
    if (items.value.length === 0) return
    if (selectedIndex.value === null) {
      selectIndex(items.value.length - 1)
    } else {
      selectIndex(selectedIndex.value - 1)
    }
  }

  function clearSelection(): void {
    selectedIndex.value = null
  }

  // Reset selection when items change (page navigation, filter change)
  watch(items, () => {
    selectedIndex.value = null
  })

  return {
    selectedIndex,
    selectedItem,
    selectIndex,
    selectByClick,
    moveUp,
    moveDown,
    clearSelection,
    isInputFocused
  }
}
