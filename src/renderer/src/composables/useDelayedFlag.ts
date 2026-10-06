/**
 * Debounced visibility for loading indicators.
 *
 * Fast responses should not flash a spinner, and once an indicator is shown
 * it should not blink off again immediately. The returned flag turns on only
 * after `source` has stayed true for `delayMs`, and once on it stays on for at
 * least `minVisibleMs` (ui-ux-audit-2026-10-06 §07: 150 ms / 300 ms).
 */
import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue'

export interface DelayedFlagOptions {
  delayMs?: number
  minVisibleMs?: number
}

export function useDelayedFlag(
  source: Ref<boolean>,
  { delayMs = 150, minVisibleMs = 300 }: DelayedFlagOptions = {}
): Readonly<Ref<boolean>> {
  const visible = ref(false)
  let shownAt = 0
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const clear = (timer: ReturnType<typeof setTimeout> | null): null => {
    if (timer !== null) clearTimeout(timer)
    return null
  }

  const onRise = (): void => {
    hideTimer = clear(hideTimer)
    if (visible.value || showTimer !== null) return
    showTimer = setTimeout(() => {
      showTimer = null
      visible.value = true
      shownAt = Date.now()
    }, delayMs)
  }

  const onFall = (): void => {
    showTimer = clear(showTimer)
    if (!visible.value || hideTimer !== null) return
    const remaining = minVisibleMs - (Date.now() - shownAt)
    if (remaining <= 0) {
      visible.value = false
      return
    }
    hideTimer = setTimeout(() => {
      hideTimer = null
      visible.value = false
    }, remaining)
  }

  watch(source, (on) => (on ? onRise() : onFall()), { immediate: true })

  onScopeDispose(() => {
    showTimer = clear(showTimer)
    hideTimer = clear(hideTimer)
  })

  return readonly(visible)
}
