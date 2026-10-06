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
 * Check if an input/textarea/select/contenteditable element is currently focused.
 * Exported at module level for reuse by useKeyboardShortcuts.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if (el.getAttribute('contenteditable') === 'true') return true
  // A focused link (table link cells) owns Enter; don't also open the row panel.
  if (tag === 'a' && el.hasAttribute('href')) return true
  return false
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
