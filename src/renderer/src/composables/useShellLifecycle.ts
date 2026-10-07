import { onMounted, onUnmounted, watch } from 'vue'
import type { Ref } from 'vue'
import type { SelectedCaseInput } from './useAppState'
import type { BatchResult, WindowAPI } from '../../../shared/types/api'
import type { useImportStatusStore } from '../stores/importStatusStore'
import type AppDialogHostType from '../components/AppDialogHost.vue'
import { useVariantColumnMeta } from './useVariantColumnMeta'
import { useLiveDataSignal } from './useLiveDataSignal'
import { isWebRuntime } from '../utils/runtime-mode'
import { leadingTrailingThrottle } from '../utils/leadingTrailingThrottle'

/** At most one in-place refresh per interval while a batch keeps finishing files. */
export const LIVE_REFRESH_INTERVAL_MS = 1000

interface CaseListActions {
  refreshCases: () => Promise<unknown> | unknown
  /** Merge newly visible cases into the list without resetting it. */
  softRefreshCases?: () => Promise<unknown> | unknown
  selectCase: (caseId: number) => void
}

interface UseShellLifecycleOptions {
  api: WindowAPI | undefined
  currentDatabasePath: Ref<string | null>
  currentDatabaseName: Ref<string>
  incrementDataGeneration: () => void
  resetForDatabaseSwitch: () => void
  clearMetadataCache: () => void
  selectCase: (input: SelectedCaseInput) => void
  caseListRef: Ref<CaseListActions | null>
  dialogHostRef: Ref<InstanceType<typeof AppDialogHostType> | null>
  importStore: ReturnType<typeof useImportStatusStore>
}

export function useShellLifecycle({
  api,
  currentDatabasePath,
  currentDatabaseName,
  incrementDataGeneration,
  resetForDatabaseSwitch,
  clearMetadataCache,
  selectCase,
  caseListRef,
  dialogHostRef,
  importStore
}: UseShellLifecycleOptions) {
  let cleanupBatchImportComplete: (() => void) | null = null
  let cleanupBatchFileComplete: (() => void) | null = null
  const variantColumnMeta = useVariantColumnMeta()
  const { notifyDataAdded } = useLiveDataSignal()

  // Cases become visible one by one during a batch. Refresh what is on screen
  // in place (case list, cohort view) without the full reload that the end of
  // the batch triggers, and never more often than once per interval.
  const liveRefresh = leadingTrailingThrottle(() => {
    notifyDataAdded()
    void caseListRef.value?.softRefreshCases?.()
  }, LIVE_REFRESH_INTERVAL_MS)

  watch(currentDatabasePath, () => {
    resetForDatabaseSwitch()
  })

  const handleDatabaseSwitched = async (): Promise<void> => {
    resetForDatabaseSwitch()
    clearMetadataCache()
    await caseListRef.value?.refreshCases()
    dialogHostRef.value?.showSnackbar(`Switched to ${currentDatabaseName.value}`, 'success')
  }

  const handleImportComplete = async (result: SelectedCaseInput): Promise<void> => {
    if (isWebRuntime()) variantColumnMeta.invalidateAll()
    incrementDataGeneration()
    await caseListRef.value?.refreshCases()
    selectCase(result)
    caseListRef.value?.selectCase(result.caseId)
  }

  const handleBatchImportComplete = (): Promise<unknown> | unknown => {
    // The full refresh below supersedes any in-place refresh still pending.
    liveRefresh.cancel()
    if (isWebRuntime()) variantColumnMeta.invalidateAll()
    incrementDataGeneration()
    return caseListRef.value?.refreshCases()
  }

  const registerBatchImportCompletionListener = (): (() => void) | null => {
    if (!api) return null

    return api.batchImport.onComplete((result) => {
      if (!importStore.isCurrentBatchRun(result.runId)) return
      const batchResult: BatchResult = {
        succeeded: result.succeeded,
        failed: result.failed,
        skipped: result.skipped,
        cancelled: result.cancelled,
        details: result.details
      }
      importStore.importComplete({
        ...batchResult,
        details: batchResult.details.map((d) => ({
          ...d,
          caseName: d.caseName ?? d.fileName,
          status: d.status === 'success' ? 'success' : d.status === 'failed' ? 'failed' : 'skipped'
        }))
      })
      // Consume ownership here, after accepting the event. ImportWizard uses
      // its own run ID, so listener order cannot suppress its terminal update.
      importStore.clearBatchRun(result.runId)
      void handleBatchImportComplete()
    })
  }

  const registerBatchFileCompleteListener = (): (() => void) | null => {
    if (!api) return null

    return api.batchImport.onFileComplete((event) => {
      if (!importStore.isCurrentBatchRun(event.runId)) return
      if (event.status === 'success') liveRefresh.call()
    })
  }

  onMounted(() => {
    cleanupBatchImportComplete = registerBatchImportCompletionListener()
    cleanupBatchFileComplete = registerBatchFileCompleteListener()
  })

  onUnmounted(() => {
    cleanupBatchImportComplete?.()
    cleanupBatchFileComplete?.()
    liveRefresh.cancel()
  })

  return {
    handleDatabaseSwitched,
    handleImportComplete,
    handleBatchImportComplete,
    setupBatchImportCompletionListener: registerBatchImportCompletionListener,
    setupBatchFileCompleteListener: registerBatchFileCompleteListener
  }
}
