<template>
  <v-dialog
    v-model="dialog"
    max-width="700"
    :persistent="phase === 'importing' || phase === 'summary'"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        Batch Import
        <v-spacer />
        <v-btn
          v-if="phase !== 'importing'"
          :icon="mdiClose"
          size="small"
          variant="text"
          @click="phase === 'summary' ? handleCancel() : closeDialog()"
        />
      </v-card-title>

      <v-card-text>
        <BatchReviewPhase
          v-if="phase === 'review'"
          v-model:strip-text="stripText"
          v-model:duplicate-strategy="duplicateStrategy"
          :review-files="reviewFiles"
          :file-count="fileCount"
          :duplicate-count="duplicateCount"
          :has-empty-case-names="hasEmptyCaseNames"
        />

        <BatchZipPasswordPhase
          v-if="phase === 'zip-password'"
          v-model:zip-password="zipPassword"
          v-model:show-zip-password="showZipPassword"
          :zip-error-message="zipErrorMessage"
          @unlock="handleZipUnlock"
        />

        <BatchProgressPhase
          v-if="phase === 'importing'"
          :current-file-name="currentFileName"
          :current-index="currentIndex"
          :total-files="totalFiles"
          :overall-percent="overallPercent"
          :variant-count="variantCount"
        />

        <BatchSummaryPhase v-if="phase === 'summary'" :summary="summary" />
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn
          v-if="phase === 'review'"
          color="primary"
          variant="flat"
          :disabled="hasEmptyCaseNames"
          @click="confirmAndStartImport"
        >
          Start Import
        </v-btn>
        <v-btn v-if="phase === 'zip-password'" variant="text" @click="handleZipCancel">
          Cancel
        </v-btn>
        <v-btn
          v-if="phase === 'zip-password'"
          color="primary"
          variant="flat"
          :loading="testingPassword"
          @click="handleZipUnlock"
        >
          Unlock
        </v-btn>
        <v-btn v-if="phase === 'importing'" variant="text" @click="continueInBackground">
          Continue in Background
        </v-btn>
        <v-btn v-if="phase === 'importing'" @click="handleCancel"> Cancel </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type {
  BatchProgressEvent,
  BatchResult,
  DuplicateChoice,
  DuplicateCheckItem
} from '../../../shared/types/api'
import { useApiService } from '../composables/useApiService'
import { useZipExtractionLifecycle } from '../composables/useZipExtractionLifecycle'
import { useImportStatusStore } from '../stores/importStatusStore'
import { logService } from '../services/LogService'
import BatchReviewPhase from './batch-import/BatchReviewPhase.vue'
import BatchProgressPhase from './batch-import/BatchProgressPhase.vue'
import BatchSummaryPhase from './batch-import/BatchSummaryPhase.vue'
import BatchZipPasswordPhase from './batch-import/BatchZipPasswordPhase.vue'
import { mdiClose } from '@mdi/js'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'

type Phase = 'idle' | 'review' | 'importing' | 'summary' | 'zip-password'

const { api } = useApiService()
const importStore = useImportStatusStore()
const zipExtraction = useZipExtractionLifecycle((id) => api!.batchImport.cleanupZipTemp(id))

const dialog = ref(false)
const phase = ref<Phase>('idle')

// File selection state
const selectedFilePaths = ref<string[]>([])

// Review state
const duplicateCheckFiles = ref<DuplicateCheckItem[]>([])
const duplicateCount = ref(0)
const fileCount = ref(0)
const duplicateStrategy = ref<DuplicateChoice>('skip')
const stripText = ref('')
const isZipImport = ref(false)

// ZIP state
const zipPath = ref('')
const zipPassword = ref('')
const showZipPassword = ref(false)
const zipErrorMessage = ref('')
const testingPassword = ref(false)

// Progress state
const currentIndex = ref(0)
const totalFiles = ref(0)
const currentFileName = ref('')
const overallPercent = ref(0)
const variantCount = ref(0)

// Summary state
const summary = ref<BatchResult>({
  succeeded: 0,
  failed: 0,
  skipped: 0,
  cancelled: false,
  details: []
})

// Cleanup function for IPC listener
let cleanupProgress: (() => void) | null = null
let activeBatchRunId: string | null = null

/**
 * Derive case name from file name (mirrors backend logic for live preview)
 */
const deriveCaseName = (fileName: string, strip: string): string => {
  let name = fileName
  if (name.endsWith('.gz') === true) name = name.slice(0, -3)
  if (name.endsWith('.json') === true) name = name.slice(0, -5)
  if (strip !== '') {
    name = name.split(strip).join('').trim()
  }
  return name
}

/**
 * Computed review files with live case name preview
 */
const reviewFiles = computed(() =>
  duplicateCheckFiles.value.map((file) => ({
    ...file,
    caseName: deriveCaseName(file.fileName, stripText.value)
  }))
)

const hasEmptyCaseNames = computed(() => reviewFiles.value.some((f) => f.caseName === ''))

/**
 * Re-check duplicates when stripText changes (debounced via watch)
 */
let recheckTimeout: ReturnType<typeof setTimeout> | null = null

// Emit refresh event when dialog closes from summary phase (handles Escape, overlay click, etc.)
watch(dialog, (newVal, oldVal) => {
  if (oldVal === true && newVal === false && phase.value === 'summary') {
    if (isZipImport.value === true) {
      void cleanupActiveZipExtraction()
    }
    if (summary.value.succeeded > 0) {
      emit('batch-import-complete', { totalImported: summary.value.succeeded })
    }
  }
})

watch(stripText, () => {
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
  recheckTimeout = setTimeout(async () => {
    if (selectedFilePaths.value.length === 0) return
    const checkResult = unwrapIpcResult(
      await api!.batchImport.checkDuplicates(
        [...selectedFilePaths.value],
        stripText.value || undefined
      )
    )
    duplicateCheckFiles.value = checkResult.files
    duplicateCount.value = checkResult.duplicateCount
  }, 300)
})

/**
 * Show dialog and start the batch import flow
 */
const show = async (mode: 'files' | 'folder' | 'zip'): Promise<void> => {
  resetState()

  if (mode === 'zip') {
    const result = unwrapIpcResult(await api!.batchImport.selectZip())
    if (result === null) return

    zipPath.value = result.filePath
    isZipImport.value = true
    dialog.value = true

    if (result.isEncrypted === true) {
      phase.value = 'zip-password'
    } else {
      await extractAndShowReview(result.filePath)
    }
    return
  }

  let filePaths: string[]

  if (mode === 'files') {
    filePaths = unwrapIpcResult(await api!.batchImport.selectFiles())
  } else {
    filePaths = unwrapIpcResult(await api!.batchImport.selectFolder())
  }

  if (filePaths.length === 0) return

  selectedFilePaths.value = filePaths
  fileCount.value = filePaths.length
  dialog.value = true

  const checkResult = unwrapIpcResult(await api!.batchImport.checkDuplicates(filePaths))
  duplicateCheckFiles.value = checkResult.files
  duplicateCount.value = checkResult.duplicateCount
  phase.value = 'review'
}

/**
 * Extract ZIP and show review phase
 */
const extractAndShowReview = async (zipFilePath: string, password?: string): Promise<void> => {
  try {
    const result = unwrapIpcResult(await api!.batchImport.extractZip(zipFilePath, password))
    zipExtraction.track(result.extractionId)

    if (result.files.length === 0) {
      zipErrorMessage.value = 'No importable files found in archive.'
      if (result.errors.length > 0) {
        zipErrorMessage.value += ' Errors: ' + result.errors.join('; ')
      }
      await cleanupActiveZipExtraction()
      return
    }

    selectedFilePaths.value = result.files
    fileCount.value = result.files.length

    const checkResult = unwrapIpcResult(await api!.batchImport.checkDuplicates(result.files))
    duplicateCheckFiles.value = checkResult.files
    duplicateCount.value = checkResult.duplicateCount
    phase.value = 'review'
  } catch (error) {
    zipErrorMessage.value =
      error instanceof Error
        ? error.message
        : isIpcError(error)
          ? (error.userMessage ?? error.message)
          : 'Failed to extract archive'
    await cleanupActiveZipExtraction()
  }
}

/**
 * User confirmed in review phase, start import
 */
const confirmAndStartImport = async (): Promise<void> => {
  if (importStore.isActive) return
  const runId = globalThis.crypto.randomUUID()
  activeBatchRunId = runId
  phase.value = 'importing'
  importStore.startImport(selectedFilePaths.value.length, runId)
  importStore.dialogOpen = true
  const filePaths = [...selectedFilePaths.value]
  const strategy = duplicateCount.value > 0 ? duplicateStrategy.value : 'skip'
  const strip = stripText.value || undefined
  await startImport(filePaths, strategy, strip, runId)
}

/**
 * Start the batch import process
 */
const startImport = async (
  filePaths: string[],
  strategy: DuplicateChoice,
  strip: string | undefined,
  runId: string
): Promise<void> => {
  totalFiles.value = filePaths.length

  try {
    const result = unwrapIpcResult(await api!.batchImport.start(filePaths, strategy, strip, runId))
    if (activeBatchRunId !== runId) return
    activeBatchRunId = null

    summary.value = result
    phase.value = 'summary'
    importStore.importComplete({
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
      cancelled: result.cancelled,
      details: []
    })
  } catch (error) {
    if (activeBatchRunId !== runId) return
    activeBatchRunId = null
    summary.value = {
      succeeded: 0,
      failed: 1,
      skipped: 0,
      cancelled: false,
      details: [
        {
          filePath: '',
          fileName: 'Batch Import',
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : isIpcError(error)
                ? (error.userMessage ?? error.message)
                : 'Unknown error'
        }
      ]
    }
    phase.value = 'summary'
    importStore.importError(
      error instanceof Error
        ? error.message
        : isIpcError(error)
          ? (error.userMessage ?? error.message)
          : 'Unknown error'
    )
  } finally {
    if (isZipImport.value) {
      try {
        await cleanupActiveZipExtraction()
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : isIpcError(error)
              ? (error.userMessage ?? error.message)
              : 'Unknown cleanup error'
        logService.warn(`ZIP extraction cleanup failed: ${message}`, 'BatchImportDialog')
      }
    }
  }
}

/**
 * Test ZIP password and extract if correct
 */
const handleZipUnlock = async (): Promise<void> => {
  testingPassword.value = true
  zipErrorMessage.value = ''

  try {
    const result = unwrapIpcResult(
      await api!.batchImport.testZipPassword(zipPath.value, zipPassword.value)
    )
    if (result.success === true) {
      await extractAndShowReview(zipPath.value, zipPassword.value)
    } else {
      zipErrorMessage.value = 'Incorrect password. Please try again.'
    }
  } catch (error) {
    zipErrorMessage.value =
      error instanceof Error
        ? error.message
        : isIpcError(error)
          ? (error.userMessage ?? error.message)
          : 'Failed to test password'
  } finally {
    testingPassword.value = false
  }
}

/**
 * Cancel ZIP flow and clean up temp directory
 */
const handleZipCancel = async (): Promise<void> => {
  await cleanupActiveZipExtraction()
  dialog.value = false
}

/**
 * Handle cancel/close button
 */
const handleCancel = async (): Promise<void> => {
  if (phase.value === 'importing') {
    unwrapIpcResult(await api!.batchImport.cancel())
  } else if (phase.value === 'summary') {
    // Close dialog — the watch on `dialog` handles cleanup and event emission
    dialog.value = false
  }
}

/**
 * Continue import in background (dismiss dialog, import keeps running)
 */
const continueInBackground = (): void => {
  importStore.dialogOpen = false
  dialog.value = false
}

/**
 * Close dialog without importing
 */
const closeDialog = async (): Promise<void> => {
  if (isZipImport.value === true) {
    await cleanupActiveZipExtraction()
  }
  dialog.value = false
}

/**
 * Reset all state for a fresh import
 */
const resetState = (): void => {
  void cleanupActiveZipExtraction()
  phase.value = 'idle'
  selectedFilePaths.value = []
  duplicateCheckFiles.value = []
  duplicateCount.value = 0
  fileCount.value = 0
  duplicateStrategy.value = 'skip'
  stripText.value = ''
  isZipImport.value = false
  currentIndex.value = 0
  totalFiles.value = 0
  currentFileName.value = ''
  overallPercent.value = 0
  variantCount.value = 0
  summary.value = { succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }
  zipPath.value = ''
  zipPassword.value = ''
  showZipPassword.value = false
  zipErrorMessage.value = ''
  testingPassword.value = false
}

async function cleanupActiveZipExtraction(): Promise<void> {
  await zipExtraction.cleanup()
}

// Setup IPC listeners
onMounted(() => {
  cleanupProgress = api!.batchImport.onProgress((progress: BatchProgressEvent) => {
    if (progress.runId !== activeBatchRunId) return
    currentIndex.value = progress.currentIndex
    totalFiles.value = progress.totalFiles
    currentFileName.value = progress.currentFileName
    overallPercent.value = progress.overallPercent

    if (progress.fileProgress !== undefined) {
      variantCount.value = progress.fileProgress.count
    }

    if (importStore.isActive) {
      importStore.updateProgress({
        fileIndex: progress.currentIndex,
        totalFiles: progress.totalFiles,
        fileName: progress.currentFileName,
        overallPercent: progress.overallPercent,
        phase: progress.fileProgress?.phase ?? 'importing',
        variantCount: progress.fileProgress?.count ?? 0,
        skipped: 0
      })
    }
  })
})

// Cleanup IPC listeners
onUnmounted(() => {
  cleanupProgress?.()
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
})

// Define emits
const emit = defineEmits<{
  'batch-import-complete': [payload: { totalImported: number }]
}>()

const reopen = (): void => {
  if (phase.value === 'importing') {
    importStore.dialogOpen = true
    dialog.value = true
  }
}

// Expose show and reopen methods to parent
defineExpose({ show, reopen })
</script>
