import type { Ref } from 'vue'
import type { DuplicateCheckItem, DuplicateCheckResult } from '../../../shared/types/api'
import type { IpcResult } from '../../../shared/types/errors'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { logService } from '../services/LogService'
import type { useImportStatusStore } from '../stores/importStatusStore'

interface ZipImportCleanupState {
  step: Ref<number>
  selectedFilePaths: Ref<string[]>
  reviewFiles: Ref<DuplicateCheckItem[]>
  duplicateCount: Ref<number>
  stripText: Ref<string>
  isZipImport: Ref<boolean>
  zipPath: Ref<string>
  zipExtractionId: Ref<string>
  zipPasswordNeeded: Ref<boolean>
  zipPassword: Ref<string>
  zipError: Ref<string>
  showZipPassword: Ref<boolean>
  zipUnlocking: Ref<boolean>
}

interface ZipImportCleanupOptions {
  cleanupRequest: (extractionId: string) => Promise<IpcResult<void>>
  checkDuplicatesRequest: (
    filePaths: string[],
    stripText?: string
  ) => Promise<IpcResult<DuplicateCheckResult>>
  importStore: ReturnType<typeof useImportStatusStore>
  state: ZipImportCleanupState
}

export function useZipImportCleanup({
  cleanupRequest,
  checkDuplicatesRequest,
  importStore,
  state
}: ZipImportCleanupOptions): {
  cleanupZipTemp: (context: string) => Promise<void>
  cleanupZipExtraction: (extractionId: string, context: string) => Promise<boolean>
  abandonZipImport: (context: string) => void
  handleDuplicateCheckFailure: (error: unknown) => Promise<void>
  handleBack: () => void
  checkDuplicatesAndAdvance: (filePaths: string[]) => Promise<void>
  scheduleDuplicateRecheck: () => void
  cancelDuplicateRecheck: () => void
} {
  let recheckTimeout: ReturnType<typeof setTimeout> | null = null
  let duplicateRequestGeneration = 0
  const pendingCleanupIds = new Set<string>()

  async function cleanupZipExtraction(extractionId: string, context: string): Promise<boolean> {
    try {
      unwrapIpcResult(await cleanupRequest(extractionId))
      pendingCleanupIds.delete(extractionId)
      return true
    } catch (error) {
      pendingCleanupIds.add(extractionId)
      const message = formatErrorMessage(error, 'ZIP temp cleanup failed')
      logService.warn(`ZIP temp cleanup failed after ${context}: ${message}`, 'ImportWizard')
      importStore.importError(message)
      return false
    }
  }

  async function cleanupZipTemp(context: string): Promise<void> {
    const extractionId = state.zipExtractionId.value
    const pendingBeforeAttempt = [...pendingCleanupIds].filter((id) => id !== extractionId)
    if (extractionId !== '') {
      const cleaned = await cleanupZipExtraction(extractionId, context)
      if (cleaned && state.zipExtractionId.value === extractionId) {
        state.zipExtractionId.value = ''
      }
    }
    await retryPendingZipCleanups(pendingBeforeAttempt, context)
  }

  async function retryPendingZipCleanups(ids: string[], context: string): Promise<void> {
    for (const extractionId of ids) {
      await cleanupZipExtraction(extractionId, `${context} retry`)
    }
  }

  function clearZipSelectionState(): void {
    state.isZipImport.value = false
    state.zipPath.value = ''
    state.zipExtractionId.value = ''
    state.zipPasswordNeeded.value = false
    state.zipPassword.value = ''
    state.zipError.value = ''
    state.showZipPassword.value = false
    state.zipUnlocking.value = false
  }

  function invalidateReviewState(): void {
    state.selectedFilePaths.value = []
    state.reviewFiles.value = []
    state.duplicateCount.value = 0
  }

  function abandonZipImport(context: string): void {
    const extractionId = state.zipExtractionId.value
    const pendingBeforeAttempt = [...pendingCleanupIds].filter((id) => id !== extractionId)
    if (!state.isZipImport.value) {
      void retryPendingZipCleanups(pendingBeforeAttempt, context)
      return
    }
    invalidateDuplicateRequests()
    clearZipSelectionState()
    invalidateReviewState()
    void (async () => {
      if (extractionId !== '') await cleanupZipExtraction(extractionId, context)
      await retryPendingZipCleanups(pendingBeforeAttempt, context)
    })()
  }

  async function handleDuplicateCheckFailure(error: unknown): Promise<void> {
    const extractionId = state.zipExtractionId.value
    const message = formatErrorMessage(error, 'Could not check duplicate cases')
    invalidateReviewState()
    state.step.value = 1
    if (extractionId !== '') {
      await cleanupZipExtraction(extractionId, 'duplicate check failure')
    }
    await retryPendingZipCleanups(
      [...pendingCleanupIds].filter((id) => id !== extractionId),
      'duplicate check failure'
    )
    clearZipSelectionState()
    logService.error(`Duplicate check failed: ${message}`, 'ImportWizard')
    importStore.importError(message)
  }

  function handleBack(): void {
    if (state.isZipImport.value) {
      abandonZipImport('review back navigation')
    } else {
      invalidateReviewState()
    }
    state.step.value = 1
  }

  async function checkDuplicatesAndAdvance(filePaths: string[]): Promise<void> {
    const generation = beginDuplicateRequest()
    try {
      const result = unwrapIpcResult(
        await checkDuplicatesRequest(filePaths, state.stripText.value || undefined)
      )
      if (generation !== duplicateRequestGeneration) return
      state.reviewFiles.value = result.files
      state.duplicateCount.value = result.duplicateCount
      state.step.value = 2
    } catch (error) {
      if (generation !== duplicateRequestGeneration) return
      await handleDuplicateCheckFailure(error)
      throw error
    }
  }

  function scheduleDuplicateRecheck(): void {
    cancelDuplicateRecheck()
    const generation = duplicateRequestGeneration
    const filePaths = [...state.selectedFilePaths.value]
    const stripText = state.stripText.value || undefined
    recheckTimeout = setTimeout(() => {
      void (async () => {
        if (filePaths.length === 0) return
        try {
          const result = unwrapIpcResult(await checkDuplicatesRequest(filePaths, stripText))
          if (generation !== duplicateRequestGeneration) return
          state.reviewFiles.value = result.files
          state.duplicateCount.value = result.duplicateCount
        } catch (error) {
          if (generation !== duplicateRequestGeneration) return
          await handleDuplicateCheckFailure(error)
        }
      })()
    }, 300)
  }

  function cancelDuplicateRecheck(): void {
    if (recheckTimeout !== null) clearTimeout(recheckTimeout)
    recheckTimeout = null
    invalidateDuplicateRequests()
  }

  function beginDuplicateRequest(): number {
    invalidateDuplicateRequests()
    return duplicateRequestGeneration
  }

  function invalidateDuplicateRequests(): void {
    duplicateRequestGeneration += 1
  }

  return {
    cleanupZipTemp,
    cleanupZipExtraction,
    abandonZipImport,
    handleDuplicateCheckFailure,
    handleBack,
    checkDuplicatesAndAdvance,
    scheduleDuplicateRecheck,
    cancelDuplicateRecheck
  }
}
