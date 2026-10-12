/**
 * Cases whose genome build must be confirmed before their chromosome names
 * are updated (contig-naming migration), and the user's answers.
 */
import { ref } from 'vue'

import type { BuildReview, BuildReviewChoice } from '../../../shared/types/build-review'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { logService } from '../services/LogService'
import { useApiService } from './useApiService'

export function useBuildReviews() {
  const { api } = useApiService()
  const reviews = ref<BuildReview[]>([])
  const renameInProgress = ref(false)
  const renameFailed = ref(false)
  const applying = ref(false)

  async function load(): Promise<void> {
    if (api === undefined) return
    try {
      const list = unwrapIpcResult(await api.cases.buildReviews())
      reviews.value = list.reviews
      renameInProgress.value = list.renameInProgress
      renameFailed.value = list.renameFailed
    } catch (error) {
      // The notice is optional: a failed check must not break the shell.
      reviews.value = []
      logService.warn(`Could not list genome build checks: ${String(error)}`, 'cases')
    }
  }

  /** Confirm the chosen builds in one write; the list is reloaded afterwards. */
  async function apply(choices: BuildReviewChoice[]): Promise<number> {
    if (api === undefined || choices.length === 0) return 0
    applying.value = true
    try {
      return unwrapIpcResult(await api.cases.resolveBuildReviews(choices))
    } finally {
      applying.value = false
      await load()
    }
  }

  return { reviews, renameInProgress, renameFailed, applying, load, apply }
}
