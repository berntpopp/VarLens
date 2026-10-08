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
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return el.getAttribute('contenteditable') === 'true'
}

/**
 * Table row shortcuts bail out on text entry and on a focused link: a
 * focused link cell owns Enter, so it must not also open the row panel.
 * An open dialog owns the keyboard: its keys must not act on the table behind.
 */
export function isInputFocused(): boolean {
  if (isTextEntryFocused()) return true
  if (document.querySelector('.v-dialog.v-overlay--active') !== null) return true
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

  function moveDown(): void {
    if (items.value.length === 0) return
    if (selectedIndex.value === null) {
      selectIndex(0)
    } else {
      selectIndex(selectedIndex.value + 1)
    }
  }

  function moveUp(): void {
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
