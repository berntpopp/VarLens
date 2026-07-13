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
  zipPasswordNeeded: Ref<boolean>
  zipPassword: Ref<string>
  zipError: Ref<string>
  showZipPassword: Ref<boolean>
  zipUnlocking: Ref<boolean>
}

interface ZipImportCleanupOptions {
  cleanupRequest: () => Promise<IpcResult<void>>
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
  abandonZipImport: (context: string) => void
  handleDuplicateCheckFailure: (error: unknown) => Promise<void>
  handleBack: () => void
  checkDuplicatesAndAdvance: (filePaths: string[]) => Promise<void>
  scheduleDuplicateRecheck: () => void
  cancelDuplicateRecheck: () => void
} {
  let recheckTimeout: ReturnType<typeof setTimeout> | null = null

  async function cleanupZipTemp(context: string): Promise<void> {
    try {
      unwrapIpcResult(await cleanupRequest())
    } catch (error) {
      const message = formatErrorMessage(error, 'ZIP temp cleanup failed')
      logService.warn(`ZIP temp cleanup failed after ${context}: ${message}`, 'ImportWizard')
      importStore.importError(message)
    }
  }

  function clearZipSelectionState(): void {
    state.isZipImport.value = false
    state.zipPath.value = ''
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
    if (!state.isZipImport.value) return
    clearZipSelectionState()
    invalidateReviewState()
    void cleanupZipTemp(context)
  }

  async function handleDuplicateCheckFailure(error: unknown): Promise<void> {
    const message = formatErrorMessage(error, 'Could not check duplicate cases')
    invalidateReviewState()
    state.step.value = 1
    await cleanupZipTemp('duplicate check failure')
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
    try {
      const result = unwrapIpcResult(
        await checkDuplicatesRequest(filePaths, state.stripText.value || undefined)
      )
      state.reviewFiles.value = result.files
      state.duplicateCount.value = result.duplicateCount
      state.step.value = 2
    } catch (error) {
      await handleDuplicateCheckFailure(error)
      throw error
    }
  }

  function scheduleDuplicateRecheck(): void {
    cancelDuplicateRecheck()
    recheckTimeout = setTimeout(() => {
      void (async () => {
        if (state.selectedFilePaths.value.length === 0) return
        try {
          const result = unwrapIpcResult(
            await checkDuplicatesRequest(
              [...state.selectedFilePaths.value],
              state.stripText.value || undefined
            )
          )
          state.reviewFiles.value = result.files
          state.duplicateCount.value = result.duplicateCount
        } catch (error) {
          await handleDuplicateCheckFailure(error)
        }
      })()
    }, 300)
  }

  function cancelDuplicateRecheck(): void {
    if (recheckTimeout !== null) clearTimeout(recheckTimeout)
    recheckTimeout = null
  }

  return {
    cleanupZipTemp,
    abandonZipImport,
    handleDuplicateCheckFailure,
    handleBack,
    checkDuplicatesAndAdvance,
    scheduleDuplicateRecheck,
    cancelDuplicateRecheck
  }
}
