/**
 * The root (rem) font size in CSS px, kept current when the user changes the
 * text size. A hidden 1rem-wide probe is watched with a ResizeObserver, so a
 * text-only resize (browser "font size" setting, root font-size override)
 * updates the value without polling and without listening to every resize.
 *
 * Used for chrome that Vuetify sizes in px (the app bar height feeds the
 * layout system as a number), so it can still scale with text.
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export const DEFAULT_ROOT_FONT_PX = 16

export function readRootFontPx(): number {
  if (typeof document === 'undefined') return DEFAULT_ROOT_FONT_PX
  const value = parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ROOT_FONT_PX
}

/** `rem` expressed in whole CSS px at the current root font size. */
export function remToPx(rem: number, rootFontPx: number): number {
  return Math.round(rem * rootFontPx)
}

export function useRootFontSize(): Ref<number> {
  const rootFontPx = ref(readRootFontPx())
  let probe: HTMLElement | null = null
  let observer: ResizeObserver | null = null

  onMounted(() => {
    rootFontPx.value = readRootFontPx()
    if (typeof ResizeObserver === 'undefined') return
    probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:absolute;top:0;left:0;width:1rem;height:0;visibility:hidden;pointer-events:none'
    document.body.appendChild(probe)
    observer = new ResizeObserver(() => {
      const next = readRootFontPx()
      if (next !== rootFontPx.value) rootFontPx.value = next
    })
    observer.observe(probe)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    probe?.remove()
  })

  return rootFontPx
}
