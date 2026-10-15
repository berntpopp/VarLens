/**
 * Phenotype column of the case table (spec .planning/specs/2026-10-15-phenotype-column.md):
 * shown by default only for a case with present HPO terms, refetched when the
 * case's terms or the HPO data change (the backend rescores on that query),
 * and the lazily fetched explanation behind its tooltip.
 */
import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { HpoExplanation } from '../../../../shared/types/hpo-profile'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import type { ColumnPreferences } from '../../composables/useColumnPreferences'
import { useCaseMetadata } from '../../composables/useCaseMetadata'
import { phenotypeChange } from '../../composables/phenotypeChanges'
import { useApiService } from '../../composables/useApiService'
import { PHENOTYPE_SCORE_KEY as PHENOTYPE_COLUMN_KEY } from '../../../../shared/sql/phenotype-score-sql'

export { PHENOTYPE_SCORE_KEY as PHENOTYPE_COLUMN_KEY } from '../../../../shared/sql/phenotype-score-sql'

/** `prefs` with the column hidden unless the case has a present term; an explicit choice wins. */
export function withPhenotypeDefault(
  prefs: Ref<ColumnPreferences>,
  caseId: () => number
): ComputedRef<ColumnPreferences> {
  const { getMetadata, loadMetadata } = useCaseMetadata()
  watch(caseId, (id) => void loadMetadata(id), { immediate: true })
  return computed(() => {
    const hasTerms = getMetadata(caseId())?.hpoTerms?.some((t) => !t.excluded) === true
    if (hasTerms || PHENOTYPE_COLUMN_KEY in prefs.value.visibility) return prefs.value
    return {
      ...prefs.value,
      visibility: { ...prefs.value.visibility, [PHENOTYPE_COLUMN_KEY]: false }
    }
  })
}

/** Refetch on a change of the case's terms or the HPO data; true while that refetch runs. */
export function usePhenotypeRefresh(
  caseId: () => number,
  refresh: () => Promise<void>
): Ref<boolean> {
  const refreshing = ref(false)
  watch(phenotypeChange, async (change) => {
    if (change === null || (change.caseId !== null && change.caseId !== caseId())) return
    refreshing.value = true
    try {
      await refresh()
    } finally {
      refreshing.value = false
    }
  })
  return refreshing
}

// One explanation per case and gene until the next term or HPO data change.
const explanations = new Map<string, Promise<HpoExplanation | null>>()
let explainedFor = phenotypeChange.value

export function explainPhenotype(caseId: number, gene: string): Promise<HpoExplanation | null> {
  if (explainedFor !== phenotypeChange.value) {
    explanations.clear()
    explainedFor = phenotypeChange.value
  }
  const key = `${caseId}\0${gene}`
  let pending = explanations.get(key)
  if (pending === undefined) {
    const { api } = useApiService()
    pending =
      api === undefined
        ? Promise.resolve(null)
        : api.hpoData.explainGene(caseId, gene).then(unwrapIpcResult)
    // A failed lookup is retried on the next hover.
    pending.catch(() => explanations.delete(key))
    explanations.set(key, pending)
  }
  return pending
}
