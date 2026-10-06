/**
 * One ACMG quick-classify menu per table instead of one `<v-menu>` per row.
 *
 * A per-row v-menu mounts a VMenu + VOverlay (+ transition) for every row on
 * every page, although at most one is ever open. The table provides a single
 * shared menu; each row's ACMG button asks it to open, anchored to that
 * button and wired to that row's handlers. `AcmgQuickMenu.vue` renders it.
 */
import { inject, provide, type InjectionKey } from 'vue'
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import { useSharedMenu, type SharedMenu } from './shared-menu'

export interface AcmgMenuRequest {
  /** Classification currently shown for the row (highlighted in the menu). */
  current: AcmgClassification | null
  select: (classification: AcmgClassification | null) => void
  openEvidence: () => void
}

export type AcmgQuickMenuState = SharedMenu<AcmgMenuRequest>

export const ACMG_QUICK_MENU_KEY: InjectionKey<AcmgQuickMenuState> = Symbol('acmg-quick-menu')

export function createAcmgQuickMenuState(): AcmgQuickMenuState {
  return useSharedMenu<AcmgMenuRequest>()
}

/** Called by a table: creates the shared menu and exposes it to its row cells. */
export function provideAcmgQuickMenu(): AcmgQuickMenuState {
  const state = createAcmgQuickMenuState()
  provide(ACMG_QUICK_MENU_KEY, state)
  return state
}

/** Called by a row cell: the table's shared menu, or null when rendered standalone. */
export function injectAcmgQuickMenu(): AcmgQuickMenuState | null {
  return inject(ACMG_QUICK_MENU_KEY, null)
}
