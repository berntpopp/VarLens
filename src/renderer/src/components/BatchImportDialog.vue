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
          icon="mdi-close"
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
        <v-btn v-if="phase === 'importing'" @click="handleCancel"> Cancel </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type {
  BatchProgress,
  BatchResult,
  DuplicateChoice,
  DuplicateCheckItem
} from '../../../shared/types/api'
import { useApiService } from '../composables/useApiService'
import BatchReviewPhase from './batch-import/BatchReviewPhase.vue'
import BatchProgressPhase from './batch-import/BatchProgressPhase.vue'
import BatchSummaryPhase from './batch-import/BatchSummaryPhase.vue'
import BatchZipPasswordPhase from './batch-import/BatchZipPasswordPhase.vue'

type Phase = 'idle' | 'review' | 'importing' | 'summary' | 'zip-password'

const { api } = useApiService()

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
// eslint-disable-next-line no-undef
let recheckTimeout: ReturnType<typeof setTimeout> | null = null

// Emit refresh event when dialog closes from summary phase (handles Escape, overlay click, etc.)
watch(dialog, (newVal, oldVal) => {
  if (oldVal === true && newVal === false && phase.value === 'summary') {
    if (isZipImport.value === true) {
      api!.batchImport.cleanupZipTemp()
    }
    if (summary.value.succeeded > 0) {
      emit('batch-import-complete', { totalImported: summary.value.succeeded })
    }
  }
})

watch(stripText, () => {
  // eslint-disable-next-line no-undef
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
  // eslint-disable-next-line no-undef
  recheckTimeout = setTimeout(async () => {
    if (selectedFilePaths.value.length === 0) return
    const checkResult = await api!.batchImport.checkDuplicates(
      [...selectedFilePaths.value],
      stripText.value || undefined
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
    const result = await api!.batchImport.selectZip()
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
    filePaths = await api!.batchImport.selectFiles()
  } else {
    filePaths = await api!.batchImport.selectFolder()
  }

  if (filePaths.length === 0) return

  selectedFilePaths.value = filePaths
  fileCount.value = filePaths.length
  dialog.value = true

  const checkResult = await api!.batchImport.checkDuplicates(filePaths)
  duplicateCheckFiles.value = checkResult.files
  duplicateCount.value = checkResult.duplicateCount
  phase.value = 'review'
}

/**
 * Extract ZIP and show review phase
 */
const extractAndShowReview = async (zipFilePath: string, password?: string): Promise<void> => {
  try {
    const result = await api!.batchImport.extractZip(zipFilePath, password)

    if (result.files.length === 0) {
      zipErrorMessage.value = 'No importable files found in archive.'
      if (result.errors.length > 0) {
        zipErrorMessage.value += ' Errors: ' + result.errors.join('; ')
      }
      await api!.batchImport.cleanupZipTemp()
      return
    }

    selectedFilePaths.value = result.files
    fileCount.value = result.files.length

    const checkResult = await api!.batchImport.checkDuplicates(result.files)
    duplicateCheckFiles.value = checkResult.files
    duplicateCount.value = checkResult.duplicateCount
    phase.value = 'review'
  } catch (error) {
    zipErrorMessage.value = error instanceof Error ? error.message : 'Failed to extract archive'
    await api!.batchImport.cleanupZipTemp()
  }
}

/**
 * User confirmed in review phase, start import
 */
const confirmAndStartImport = async (): Promise<void> => {
  phase.value = 'importing'
  const filePaths = [...selectedFilePaths.value]
  const strategy = duplicateCount.value > 0 ? duplicateStrategy.value : 'skip'
  const strip = stripText.value || undefined
  await startImport(filePaths, strategy, strip)
}

/**
 * Start the batch import process
 */
const startImport = async (
  filePaths: string[],
  strategy: DuplicateChoice,
  strip?: string
): Promise<void> => {
  totalFiles.value = filePaths.length

  try {
    const result = await api!.batchImport.start(filePaths, strategy, strip)

    summary.value = result
    phase.value = 'summary'
  } catch (error) {
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
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      ]
    }
    phase.value = 'summary'
  }
}

/**
 * Test ZIP password and extract if correct
 */
const handleZipUnlock = async (): Promise<void> => {
  testingPassword.value = true
  zipErrorMessage.value = ''

  try {
    const result = await api!.batchImport.testZipPassword(zipPath.value, zipPassword.value)
    if (result.success === true) {
      await extractAndShowReview(zipPath.value, zipPassword.value)
    } else {
      zipErrorMessage.value = 'Incorrect password. Please try again.'
    }
  } catch (error) {
    zipErrorMessage.value = error instanceof Error ? error.message : 'Failed to test password'
  } finally {
    testingPassword.value = false
  }
}

/**
 * Cancel ZIP flow and clean up temp directory
 */
const handleZipCancel = async (): Promise<void> => {
  await api!.batchImport.cleanupZipTemp()
  dialog.value = false
}

/**
 * Handle cancel/close button
 */
const handleCancel = async (): Promise<void> => {
  if (phase.value === 'importing') {
    await api!.batchImport.cancel()
  } else if (phase.value === 'summary') {
    // Close dialog — the watch on `dialog` handles cleanup and event emission
    dialog.value = false
  }
}

/**
 * Close dialog without importing
 */
const closeDialog = async (): Promise<void> => {
  if (isZipImport.value === true) {
    await api!.batchImport.cleanupZipTemp()
  }
  dialog.value = false
}

/**
 * Reset all state for a fresh import
 */
const resetState = (): void => {
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

// Setup IPC listeners
onMounted(() => {
  cleanupProgress = api!.batchImport.onProgress((progress: BatchProgress) => {
    currentIndex.value = progress.currentIndex
    totalFiles.value = progress.totalFiles
    currentFileName.value = progress.currentFileName
    overallPercent.value = progress.overallPercent

    if (progress.fileProgress !== undefined) {
      variantCount.value = progress.fileProgress.count
    }
  })
})

// Cleanup IPC listeners
onUnmounted(() => {
  cleanupProgress?.()
  // eslint-disable-next-line no-undef
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
})

// Define emits
const emit = defineEmits<{
  'batch-import-complete': [payload: { totalImported: number }]
}>()

// Expose show method to parent
defineExpose({ show })
</script>
