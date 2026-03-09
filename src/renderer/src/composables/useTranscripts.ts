import { ref, watch, type Ref } from 'vue'
import type { TranscriptAnnotation, TranscriptInsertRow } from '../../../shared/types/transcript'
import { useApiService } from './useApiService'

/**
 * Composable for loading and switching variant transcripts.
 *
 * @param variantId - reactive variant ID (null when no variant selected)
 * @returns transcripts list, loading state, and switch function
 */
export function useTranscripts(variantId: Ref<number | null>) {
  const { api } = useApiService()
  const transcripts = ref<TranscriptAnnotation[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function loadTranscripts(id: number): Promise<void> {
    if (!api) return
    loading.value = true
    error.value = null
    try {
      transcripts.value = await api.transcripts.list(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      transcripts.value = []
    } finally {
      loading.value = false
    }
  }

  async function switchTranscript(transcriptId: string): Promise<boolean> {
    if (!api || variantId.value === null) return false
    try {
      await api.transcripts.switch(variantId.value, transcriptId)
      // Reload to get updated state
      await loadTranscripts(variantId.value)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  async function insertAndSwitch(transcript: TranscriptInsertRow): Promise<boolean> {
    if (!api || variantId.value === null) return false
    try {
      await api.transcripts.insertAndSwitch(variantId.value, transcript)
      await loadTranscripts(variantId.value)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return false
    }
  }

  watch(
    variantId,
    async (newId) => {
      if (newId !== null) {
        await loadTranscripts(newId)
      } else {
        transcripts.value = []
      }
    },
    { immediate: true }
  )

  return {
    transcripts,
    loading,
    error,
    switchTranscript,
    insertAndSwitch
  }
}
