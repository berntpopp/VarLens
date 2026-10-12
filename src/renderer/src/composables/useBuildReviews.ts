/**
 * Cases whose genome build must be confirmed before their chromosome names
 * are updated (contig-naming migration), and the user's answers.
 */
import { ref } from 'vue'

import type { BuildReview } from '../../../shared/types/build-review'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { logService } from '../services/LogService'
import { useApiService } from './useApiService'

export function useBuildReviews() {
  const { api } = useApiService()
  const reviews = ref<BuildReview[]>([])
  const applying = ref(false)

  async function load(): Promise<void> {
    if (api === undefined) return
    try {
      reviews.value = unwrapIpcResult(await api.cases.buildReviews())
    } catch (error) {
      // The notice is optional: a failed check must not break the shell.
      reviews.value = []
      logService.warn(`Could not list genome build checks: ${String(error)}`, 'cases')
    }
  }

  /** Apply the chosen builds one case at a time; the list is reloaded afterwards. */
  async function apply(choices: ReadonlyMap<number, string>): Promise<number> {
    if (api === undefined) return 0
    applying.value = true
    let applied = 0
    try {
      for (const [caseId, build] of choices) {
        unwrapIpcResult(await api.cases.resolveBuildReview(caseId, build))
        applied++
      }
    } finally {
      applying.value = false
      await load()
    }
    return applied
  }

  return { reviews, applying, load, apply }
}
