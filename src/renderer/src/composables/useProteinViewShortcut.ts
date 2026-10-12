import { inject } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'
import { AppStateKey } from './useAppState'
import { hasCommandModifier, isInputFocused } from './useTableKeyboardNav'
import { SHORTCUTS } from '../config/keyboardShortcuts'

/**
 * `p`: open the protein view for the table's selected row (case + cohort
 * tables). `target` is that row, or null while the table is not the active
 * view. The shell's ProteinViewHost says why when the view cannot open.
 */
export function useProteinViewShortcut(target: () => Variant | CohortVariant | null): void {
  const appState = inject(AppStateKey, null)
  onKeyStroke(
    SHORTCUTS.proteinView.key,
    (e: KeyboardEvent) => {
      const variant = target()
      if (hasCommandModifier(e) || isInputFocused() || variant === null) return
      e.preventDefault()
      appState?.openProteinView(variant)
    },
    { dedupe: true }
  )
}
