import type { Ref } from 'vue'
import type { BatchResult, WindowAPI } from '../../../shared/types/api'
import { formatErrorMessage } from '../../../shared/errors/format-error-message'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { logService } from '../services/LogService'

interface ImportRunStore {
  isActive: boolean
  dialogOpen: boolean
  startImport(files: number): void
  importComplete(result: {
    succeeded: number
    failed: number
    skipped: number
    cancelled: boolean
    details: Array<{
      filePath: string
      fileName: string
      caseName: string
      status: 'pending' | 'importing' | 'success' | 'failed' | 'skipped'
      variantCount?: number
      error?: string
    }>
  }): void
  importError(message: string): void
}

interface VcfImportExecutionState {
  filePath: Ref<string>
  selectedSamples: Ref<string[]>
  genomeBuild: Ref<string>
  caseNames: Ref<Map<string, string>>
  step: Ref<number>
  totalFiles: Ref<number>
  currentIndex: Ref<number>
  overallPercent: Ref<number>
  variantCount: Ref<number>
  currentFileName: Ref<string>
  cancelError: Ref<string>
  summary: Ref<BatchResult>
}

interface VcfImportRunAuthority {
  begin(): number
  isTerminal(generation: number): boolean
  isCancellationRequested(generation: number): boolean
  completeCancelled(generation: number): void
}

interface UseVcfImportExecutionOptions {
  api: WindowAPI
  importStore: ImportRunStore
  state: VcfImportExecutionState
  authority: VcfImportRunAuthority
  onImported(totalImported: number): void
}

export function useVcfImportExecution({
  api,
  importStore,
  state,
  authority,
  onImported
}: UseVcfImportExecutionOptions): { startVcfImport: () => Promise<void> } {
  function finishCancellation(generation: number): boolean {
    if (!authority.isCancellationRequested(generation)) return false
    authority.completeCancelled(generation)
    return true
  }

  async function startVcfImport(): Promise<void> {
    if (importStore.isActive) {
      logService.warn('Import already in progress — cannot start another', 'ImportWizard')
      return
    }

    const generation = authority.begin()
    state.step.value = 3
    state.totalFiles.value = state.selectedSamples.value.length
    state.currentIndex.value = 0
    state.overallPercent.value = 0
    state.variantCount.value = 0
    importStore.startImport(state.selectedSamples.value.length)
    importStore.dialogOpen = true

    const results: BatchResult = {
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: []
    }

    try {
      for (let index = 0; index < state.selectedSamples.value.length; index++) {
        if (finishCancellation(generation)) return
        if (authority.isTerminal(generation)) break

        const sample = state.selectedSamples.value[index]
        const caseName = state.caseNames.value.get(sample) ?? sample
        state.currentIndex.value = index
        state.currentFileName.value = caseName
        state.overallPercent.value = Math.round(
          ((index + 1) / state.selectedSamples.value.length) * 100
        )

        try {
          const result = unwrapIpcResult(
            await api.import.start(state.filePath.value, caseName, {
              selectedSample: sample,
              genomeBuild: state.genomeBuild.value ?? undefined
            })
          )
          if (finishCancellation(generation)) return
          if (authority.isTerminal(generation)) break

          results.succeeded += 1
          results.details.push({
            filePath: state.filePath.value,
            fileName: caseName,
            caseName,
            status: 'success',
            variantCount: result.variantCount
          })
        } catch (error) {
          if (finishCancellation(generation)) return
          if (authority.isTerminal(generation)) break
          results.failed += 1
          results.details.push({
            filePath: state.filePath.value,
            fileName: caseName,
            caseName,
            status: 'failed',
            error: formatErrorMessage(error, 'VCF import failed')
          })
        }
      }

      if (finishCancellation(generation) || authority.isTerminal(generation)) return
      state.cancelError.value = ''
      state.summary.value = results
      state.step.value = 4
      importStore.importComplete({
        ...results,
        details: results.details.map((detail) => ({
          ...detail,
          caseName: detail.caseName ?? detail.fileName
        }))
      })
      if (results.succeeded > 0) onImported(results.succeeded)
    } catch (error) {
      if (finishCancellation(generation) || authority.isTerminal(generation)) return
      const message = formatErrorMessage(error, 'VCF import failed')
      logService.error(`VCF import failed: ${message}`, 'ImportWizard')
      state.cancelError.value = ''
      state.summary.value = {
        succeeded: 0,
        failed: state.selectedSamples.value.length,
        skipped: 0,
        cancelled: false,
        details: []
      }
      state.step.value = 4
      importStore.importError(message)
    }
  }

  return { startVcfImport }
}
