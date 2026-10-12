/**
 * App-wide open state of the "Shortlist ranking" dialog: the settings menu
 * and the Shortlist tab's "Edit ranking" button open it, `AppDialogHost`
 * renders it. Module state, like the dialog itself, exists once.
 */
import { reactive } from 'vue'

const state = reactive({ open: false, presetId: null as number | null })

export function useShortlistRankingDialog() {
  return {
    state,
    /** Open the dialog on `presetId`, else on the default ranking. */
    open(presetId: number | null = null): void {
      state.presetId = presetId
      state.open = true
    }
  }
}
