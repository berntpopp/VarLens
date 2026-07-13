import { ref, computed } from 'vue'
import { defineStore } from 'pinia'

export type ImportPhase =
  'idle' | 'uploading' | 'importing' | 'finalizing' | 'complete' | 'error' | 'cancelled'

export interface ImportFileDetail {
  filePath: string
  fileName: string
  caseName: string
  status: 'pending' | 'importing' | 'success' | 'failed' | 'skipped'
  variantCount?: number
  error?: string
}

export const useImportStatusStore = defineStore('importStatus', () => {
  const phase = ref<ImportPhase>('idle')
  const currentFileIndex = ref(0)
  const totalFiles = ref(0)
  const currentFileName = ref('')
  const overallPercent = ref(0)
  const currentPhase = ref('')
  const variantCount = ref(0)
  const skipped = ref(0)
  const startTime = ref(0)
  const dialogOpen = ref(false)
  const details = ref<ImportFileDetail[]>([])
  const errorMessage = ref('')
  const uploadLoadedBytes = ref(0)
  const uploadTotalBytes = ref<number | null>(null)
  const activeBatchRunId = ref<string | null>(null)

  const isActive = computed(
    () => phase.value === 'uploading' || phase.value === 'importing' || phase.value === 'finalizing'
  )

  const fileProgress = computed(() =>
    totalFiles.value > 0 ? `${currentFileIndex.value + 1}/${totalFiles.value}` : ''
  )

  function startImport(files: number, batchRunId?: string): void {
    phase.value = 'importing'
    totalFiles.value = files
    currentFileIndex.value = 0
    overallPercent.value = 0
    variantCount.value = 0
    skipped.value = 0
    startTime.value = Date.now()
    details.value = []
    errorMessage.value = ''
    uploadLoadedBytes.value = 0
    uploadTotalBytes.value = null
    activeBatchRunId.value = batchRunId ?? null
  }

  function startUpload(files: number): void {
    phase.value = 'uploading'
    totalFiles.value = files
    currentFileIndex.value = 0
    currentFileName.value = ''
    overallPercent.value = 0
    currentPhase.value = 'uploading'
    variantCount.value = 0
    skipped.value = 0
    startTime.value = Date.now()
    details.value = []
    errorMessage.value = ''
    uploadLoadedBytes.value = 0
    uploadTotalBytes.value = null
    activeBatchRunId.value = null
  }

  function isCurrentBatchRun(runId: string): boolean {
    return activeBatchRunId.value === runId
  }

  function clearBatchRun(runId: string): void {
    if (activeBatchRunId.value === runId) activeBatchRunId.value = null
  }

  function updateUploadProgress(data: {
    fileIndex: number
    totalFiles: number
    fileName: string
    loadedBytes: number
    totalBytes: number | null
    percent: number | null
  }): void {
    phase.value = 'uploading'
    currentFileIndex.value = data.fileIndex
    totalFiles.value = data.totalFiles
    currentFileName.value = data.fileName
    uploadLoadedBytes.value = data.loadedBytes
    uploadTotalBytes.value = data.totalBytes
    overallPercent.value = data.percent ?? 0
    currentPhase.value = 'uploading'
  }

  function updateProgress(data: {
    fileIndex: number
    totalFiles: number
    fileName: string
    overallPercent: number
    phase: string
    variantCount: number
    skipped: number
  }): void {
    currentFileIndex.value = data.fileIndex
    totalFiles.value = data.totalFiles
    currentFileName.value = data.fileName
    overallPercent.value = data.overallPercent
    currentPhase.value = data.phase
    variantCount.value = data.variantCount
    skipped.value = data.skipped

    if (data.phase === 'finalizing') {
      phase.value = 'finalizing'
    }
  }

  function fileComplete(detail: ImportFileDetail): void {
    details.value.push(detail)
  }

  function importComplete(result: {
    succeeded: number
    failed: number
    skipped: number
    cancelled: boolean
    details: ImportFileDetail[]
  }): void {
    phase.value = result.cancelled ? 'cancelled' : 'complete'
    details.value = result.details
    overallPercent.value = 100
  }

  function importError(error: string): void {
    phase.value = 'error'
    errorMessage.value = error
  }

  function reset(): void {
    phase.value = 'idle'
    currentFileIndex.value = 0
    totalFiles.value = 0
    currentFileName.value = ''
    overallPercent.value = 0
    currentPhase.value = ''
    variantCount.value = 0
    skipped.value = 0
    startTime.value = 0
    dialogOpen.value = false
    details.value = []
    errorMessage.value = ''
    uploadLoadedBytes.value = 0
    uploadTotalBytes.value = null
    activeBatchRunId.value = null
  }

  return {
    phase,
    currentFileIndex,
    totalFiles,
    currentFileName,
    overallPercent,
    currentPhase,
    variantCount,
    skipped,
    startTime,
    dialogOpen,
    details,
    errorMessage,
    uploadLoadedBytes,
    uploadTotalBytes,
    activeBatchRunId,
    isActive,
    fileProgress,
    startUpload,
    updateUploadProgress,
    startImport,
    isCurrentBatchRun,
    clearBatchRun,
    updateProgress,
    fileComplete,
    importComplete,
    importError,
    reset
  }
})
