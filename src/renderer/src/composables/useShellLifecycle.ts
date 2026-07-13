import { onMounted, onUnmounted, watch } from 'vue'
import type { Ref } from 'vue'
import type { SelectedCaseInput } from './useAppState'
import type { BatchResult, WindowAPI } from '../../../shared/types/api'
import type { useImportStatusStore } from '../stores/importStatusStore'
import type AppDialogHostType from '../components/AppDialogHost.vue'
import { useVariantColumnMeta } from './useVariantColumnMeta'
import { isWebRuntime } from '../utils/runtime-mode'

interface CaseListActions {
  refreshCases: () => Promise<unknown> | unknown
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
  const variantColumnMeta = useVariantColumnMeta()

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

  onMounted(() => {
    cleanupBatchImportComplete = registerBatchImportCompletionListener()
  })

  onUnmounted(() => {
    cleanupBatchImportComplete?.()
  })

  return {
    handleDatabaseSwitched,
    handleImportComplete,
    handleBatchImportComplete,
    setupBatchImportCompletionListener: registerBatchImportCompletionListener
  }
}
