/**
 * One tooltip for the whole app, driven by `data-tooltip` attributes.
 *
 * Per-element `<v-tooltip>` instances cost a component (and, with Vuetify 4's
 * eager default, a hidden `role="tooltip"` node) per cell — hundreds in the
 * variant tables. Instead, elements declare `data-tooltip="text"` (and
 * optionally `data-tooltip-location`) and a single delegated listener shows
 * one shared tooltip for whichever element is hovered or keyboard-focused.
 *
 * Accessibility: the tooltip is supplementary. Elements must carry their own
 * accessible name (aria-label / text); the tooltip is dismissible with Escape
 * (WCAG 1.4.13) and also appears on keyboard focus.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, type Ref, type ShallowRef } from 'vue'

export type TooltipLocation = 'top' | 'bottom' | 'start' | 'end'

const LOCATIONS: readonly TooltipLocation[] = ['top', 'bottom', 'start', 'end']
const DEFAULT_OPEN_DELAY_MS = 400

export interface TooltipTarget {
  element: HTMLElement
  text: string
  location: TooltipLocation
}

/** Resolve the nearest element that declares a tooltip, or null. */
export function findTooltipTarget(node: EventTarget | null): TooltipTarget | null {
  if (!(node instanceof Element)) return null
  const element = node.closest<HTMLElement>('[data-tooltip]')
  if (!element) return null
  const text = element.dataset.tooltip?.trim() ?? ''
  if (text === '') return null
  const requested = element.dataset.tooltipLocation as TooltipLocation | undefined
  const location = requested && LOCATIONS.includes(requested) ? requested : 'bottom'
  return { element, text, location }
}

export interface DelegatedTooltipState {
  open: Ref<boolean>
  text: Ref<string>
  location: Ref<TooltipLocation>
  target: ShallowRef<HTMLElement | null>
}

export function useDelegatedTooltip(
  root: () => Document | HTMLElement = () => document,
  openDelayMs = DEFAULT_OPEN_DELAY_MS
): DelegatedTooltipState {
  const open = ref(false)
  const text = ref('')
  const location = ref<TooltipLocation>('bottom')
  const target = shallowRef<HTMLElement | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  function show(next: TooltipTarget, delay: number): void {
    clearTimer()
    const apply = (): void => {
      target.value = next.element
      text.value = next.text
      location.value = next.location
      open.value = true
    }
    if (delay <= 0) apply()
    else timer = setTimeout(apply, delay)
  }

  function hide(): void {
    clearTimer()
    open.value = false
  }

  function onPointerOver(event: Event): void {
    const next = findTooltipTarget(event.target)
    if (!next) {
      hide()
      return
    }
    if (open.value && next.element === target.value) return
    show(next, open.value ? 0 : openDelayMs)
  }

  function onPointerOut(event: Event): void {
    const related = (event as PointerEvent).relatedTarget
    if (related === null || !findTooltipTarget(related)) hide()
  }

  function onFocusIn(event: Event): void {
    const next = findTooltipTarget(event.target)
    const el = event.target as HTMLElement | null
    if (next && el?.matches?.(':focus-visible') === true) show(next, 0)
    else hide()
  }

  function onKeyDown(event: Event): void {
    if ((event as KeyboardEvent).key === 'Escape') hide()
  }

  const listeners: Array<[string, (event: Event) => void, boolean]> = [
    ['pointerover', onPointerOver, false],
    ['pointerout', onPointerOut, false],
    ['pointerdown', hide, true],
    ['focusin', onFocusIn, false],
    ['focusout', hide, false],
    ['keydown', onKeyDown, true],
    ['scroll', hide, true]
  ]

  onMounted(() => {
    const el = root()
    for (const [name, fn, capture] of listeners) el.addEventListener(name, fn, capture)
  })

  onBeforeUnmount(() => {
    clearTimer()
    const el = root()
    for (const [name, fn, capture] of listeners) el.removeEventListener(name, fn, capture)
  })

  return { open, text, location, target }
}
