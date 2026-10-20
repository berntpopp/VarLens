/**
 * Arrow-key live sync of an open details panel: after a short pause on a row,
 * the panel follows the keyboard selection. Shared by the case and shortlist tables.
 */
import { inject, onScopeDispose, watch, type Ref } from 'vue'
import { AppStateKey } from './useAppState'
import { APP_CONFIG } from '../../../shared/config/app.config'

export interface DetailsLiveSyncOptions<T> {
  /** View is visible and accepts keyboard input. */
  isActive: () => boolean
  selectedItem: Readonly<Ref<T | null>>
  selectByClick: (item: T) => void
  open: (item: T) => void
}

export function useDetailsLiveSync<T>(options: DetailsLiveSyncOptions<T>) {
  const { isActive, selectedItem, selectByClick, open } = options
  const appState = inject(AppStateKey, null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let gen = 0

  function cancel(): void {
    gen++
    if (timer !== null) clearTimeout(timer)
    timer = null
  }

  const canSync = (): boolean => isActive() && appState?.panelOpen.value === true

  /** Call after each keyboard move; only the last move within the pause opens. */
  function schedule(): void {
    cancel()
    if (!appState || !canSync() || selectedItem.value === null) return
    const state = appState
    const myGen = gen
    timer = setTimeout(async () => {
      timer = null
      if (!canSync() || selectedItem.value === null || myGen !== gen) return
      // Unsaved draft in the panel: the user may refuse to leave it
      const leave = state.confirmPanelLeave?.() ?? null
      if (leave !== null) {
        const ok = await leave
        if (myGen !== gen) return
        if (!ok) {
          const panelVar = state.selectedPanelVariant.value
          if (panelVar && 'id' in panelVar) selectByClick(panelVar as T)
          return
        }
      }
      if (!canSync() || selectedItem.value === null || myGen !== gen) return
      open(selectedItem.value)
    }, APP_CONFIG.DETAILS_LIVE_SYNC_MS)
  }

  watch(isActive, (ok) => {
    if (!ok) cancel()
  })
  onScopeDispose(cancel)

  return { schedule, cancel }
}
