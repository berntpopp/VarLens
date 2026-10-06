import { ref, watch, type Ref } from 'vue'
import type { TranscriptAnnotation, TranscriptInsertRow } from '../../../shared/types/transcript'
import { useApiService } from './useApiService'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'

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
  let currentToken = 0

  async function loadTranscripts(id: number): Promise<void> {
    const token = ++currentToken
    if (!api) return
    loading.value = true
    error.value = null
    try {
      const result = unwrapIpcResult(await api.transcripts.list(id))
      if (token !== currentToken || id !== variantId.value) return
      transcripts.value = result
    } catch (e) {
      if (token !== currentToken || id !== variantId.value) return
      error.value =
        e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
      transcripts.value = []
    } finally {
      if (token === currentToken && id === variantId.value) {
        loading.value = false
      }
    }
  }

  async function switchTranscript(transcriptId: string): Promise<boolean> {
    if (!api || variantId.value === null) return false
    const targetVariantId = variantId.value
    try {
      unwrapIpcResult(await api.transcripts.switch(targetVariantId, transcriptId))
      // Reload to get updated state if variant hasn't changed
      if (variantId.value === targetVariantId) {
        await loadTranscripts(targetVariantId)
      }
      return true
    } catch (e) {
      if (variantId.value === targetVariantId) {
        error.value =
          e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
      }
      return false
    }
  }

  async function insertAndSwitch(transcript: TranscriptInsertRow): Promise<boolean> {
    if (!api || variantId.value === null) return false
    const targetVariantId = variantId.value
    try {
      unwrapIpcResult(await api.transcripts.insertAndSwitch(targetVariantId, transcript))
      if (variantId.value === targetVariantId) {
        await loadTranscripts(targetVariantId)
      }
      return true
    } catch (e) {
      if (variantId.value === targetVariantId) {
        error.value =
          e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
      }
      return false
    }
  }

  watch(
    variantId,
    async (newId) => {
      if (newId !== null) {
        await loadTranscripts(newId)
      } else {
        currentToken++
        transcripts.value = []
        loading.value = false
        error.value = null
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
