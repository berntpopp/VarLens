import { computed, ref, watch, type Ref } from 'vue'
import { useQuery } from '@pinia/colada'
import type { TranscriptAnnotation, TranscriptInsertRow } from '../../../shared/types/transcript'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { queryApi } from '../queries/gate'
import { refetchAfterWrite } from '../queries/invalidation'
import { queryKeys } from '../queries/keys'
import { transcriptsQuery } from '../queries/transcripts'
import { formatError } from '../utils/ipc-result'

/**
 * The transcripts of one variant, and switching the selected one.
 *
 * Reads come from the query cache (`queries/transcripts.ts`) and follow the
 * variant passed in; `null` reads nothing. A switch resolves once the list has
 * been refetched.
 */
export function useTranscripts(variantId: Ref<number | null>) {
  const { data, asyncStatus, error: loadError } = useQuery(() => transcriptsQuery(variantId.value))
  const transcripts = computed<TranscriptAnnotation[]>(() => data.value ?? [])
  /** True only until a variant's first result: a refresh keeps the list shown. */
  const loading = computed(() => asyncStatus.value === 'loading' && data.value === undefined)

  const writeError = ref<string | null>(null)
  watch(variantId, () => (writeError.value = null))
  const error = computed(
    () => writeError.value ?? (loadError.value === null ? null : formatError(loadError.value))
  )

  /** Run a write for the current variant; false if it failed or none is selected. */
  async function write(run: (variantId: number) => Promise<unknown>): Promise<boolean> {
    const target = variantId.value
    if (target === null) return false
    const key = queryKeys.transcripts(target)
    try {
      unwrapIpcResult(await run(target))
      await refetchAfterWrite(key)
      return true
    } catch (e) {
      if (variantId.value === target) writeError.value = formatError(e)
      return false
    }
  }

  function switchTranscript(transcriptId: string): Promise<boolean> {
    return write((target) => queryApi().transcripts.switch(target, transcriptId))
  }

  function insertAndSwitch(transcript: TranscriptInsertRow): Promise<boolean> {
    return write((target) => queryApi().transcripts.insertAndSwitch(target, transcript))
  }

  return { transcripts, loading, error, switchTranscript, insertAndSwitch }
}
