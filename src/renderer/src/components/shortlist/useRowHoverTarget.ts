/**
 * Delegated hover tracking for one shared per-row tooltip.
 *
 * Instead of a `<v-tooltip>` per row, cells mark their trigger element with a
 * data attribute and the table forwards its mouseover/mouseout events here.
 * The composable resolves the hovered trigger, waits `openDelayMs` (the app's
 * tooltip delay), and exposes the element + row id for a single v-tooltip.
 */
import { onBeforeUnmount, ref, shallowRef, type Ref, type ShallowRef } from 'vue'

export interface RowHoverTarget {
  open: Ref<boolean>
  element: ShallowRef<HTMLElement | null>
  rowId: Ref<string | null>
  onMouseover: (event: MouseEvent) => void
  onMouseout: (event: MouseEvent) => void
  close: () => void
}

export function useRowHoverTarget(attribute: string, openDelayMs = 400): RowHoverTarget {
  const open = ref(false)
  const element = shallowRef<HTMLElement | null>(null)
  const rowId = ref<string | null>(null)
  const selector = `[${attribute}]`
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: HTMLElement | null = null

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = null
  }

  function triggerOf(node: EventTarget | null): HTMLElement | null {
    return node instanceof Element ? node.closest<HTMLElement>(selector) : null
  }

  function close(): void {
    clearTimer()
    open.value = false
  }

  function onMouseover(event: MouseEvent): void {
    const trigger = triggerOf(event.target)
    if (trigger === null || trigger === pending || (open.value && trigger === element.value)) return
    clearTimer()
    open.value = false
    pending = trigger
    timer = setTimeout(() => {
      timer = null
      pending = null
      element.value = trigger
      rowId.value = trigger.getAttribute(attribute)
      open.value = true
    }, openDelayMs)
  }

  function onMouseout(event: MouseEvent): void {
    const from = triggerOf(event.target)
    if (from === null) return
    // Moving between children of the same trigger is not leaving it.
    if (event.relatedTarget instanceof Node && from.contains(event.relatedTarget)) return
    close()
  }

  onBeforeUnmount(clearTimer)

  return { open, element, rowId, onMouseover, onMouseout, close }
}
