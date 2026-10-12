/**
 * Preview of a ranking draft on the open case (spec §12, Task 19): the top
 * rows under the edited configuration, each with its change in rank against
 * the saved preset. Runs on demand through the existing `variants:shortlist`
 * IPC (`adHocConfig` for the draft, `presetId` for the saved ranking).
 */
import { computed, ref, shallowRef, type Ref } from 'vue'
import { useApiService } from './useApiService'
import { formatError } from '../utils/ipc-result'
import { unwrapIpcResult } from '../../../shared/types/errors'
import type { ShortlistConfig, ShortlistRow } from '../../../shared/types/shortlist'

export interface PreviewRow {
  id: number
  rank: number
  gene: string
  variant: string
  score: number
  /** Saved rank − draft rank (positive = moved up); null = not in the saved list. */
  delta: number | null
}

/** The first `n` draft rows with their rank change against `saved` (null: nothing to compare). */
export function rankDeltas(
  draft: readonly ShortlistRow[],
  saved: readonly ShortlistRow[] | null,
  n: number
): PreviewRow[] {
  const savedRank = new Map(saved?.map((r) => [r.id, r.rank]))
  return draft.slice(0, n).map((r) => {
    const before = savedRank.get(r.id)
    return {
      id: r.id,
      rank: r.rank,
      gene: r.gene_symbol ?? '',
      variant: `${r.chr}:${r.pos} ${r.ref}>${r.alt}`,
      score: r.rank_score,
      delta: before === undefined ? null : before - r.rank
    }
  })
}

export function useRankingPreview(
  caseId: Ref<number | null>,
  config: () => ShortlistConfig | null,
  savedPresetId: () => number | null,
  rows: number
) {
  const { api } = useApiService()
  const result = shallowRef<PreviewRow[] | null>(null)
  const compared = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const previewed = ref<string | null>(null)
  const stale = computed(
    () => result.value !== null && previewed.value !== JSON.stringify(config())
  )

  async function run(): Promise<void> {
    const id = caseId.value
    const draft = config()
    if (id === null || draft === null || api === undefined) return
    const presetId = savedPresetId()
    loading.value = true
    error.value = null
    try {
      const [edited, saved] = await Promise.all([
        api.variants.shortlist({ caseId: id, adHocConfig: JSON.parse(JSON.stringify(draft)) }),
        presetId === null ? null : api.variants.shortlist({ caseId: id, presetId })
      ])
      const savedRows = saved === null ? null : unwrapIpcResult(saved).rows
      result.value = rankDeltas(unwrapIpcResult(edited).rows, savedRows, rows)
      compared.value = savedRows !== null
      previewed.value = JSON.stringify(draft)
    } catch (e) {
      error.value = formatError(e)
      result.value = null
    } finally {
      loading.value = false
    }
  }

  return { result, compared, loading, error, stale, run }
}
