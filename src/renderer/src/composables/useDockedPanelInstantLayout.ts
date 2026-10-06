import { computed, ref, watch, type Ref } from 'vue'

/**
 * Whether the app shell should resize instantly (no Vuetify layout transition)
 * because the variant details panel is docked.
 *
 * A docked panel shrinks `v-main` and the app footer. Vuetify animates that
 * over 0.2 s, which slides every right-aligned control (table pagination,
 * toolbar buttons, footer actions) across ~12 frames — each frame is a layout
 * shift (row-select allShifts ~0.1). Resizing in one frame moves them once.
 * The panel's own slide-in stays animated: it is a transform, not a shift.
 *
 * Stays on for two frames after closing so the un-dock reflow is instant too.
 */
export function useDockedPanelInstantLayout(
  panelOpen: Ref<boolean>,
  docked: Ref<boolean>
): Ref<boolean> {
  const settlingClose = ref(false)
  let settleToken = 0

  watch(panelOpen, (open) => {
    settleToken += 1
    if (open) {
      settlingClose.value = false
      return
    }
    const token = settleToken
    settlingClose.value = true
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token === settleToken) settlingClose.value = false
      })
    )
  })

  return computed(() => docked.value && (panelOpen.value || settlingClose.value))
}
