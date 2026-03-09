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
        <!-- Review phase (always shown before import) -->
        <div v-if="phase === 'review'">
          <v-text-field
            v-model="stripText"
            label="Remove from names"
            placeholder="e.g. _results, LB24-"
            variant="outlined"
            density="compact"
            clearable
            hide-details
            class="mb-3"
            prepend-inner-icon="mdi-text-search-variant"
          />

          <v-alert v-if="duplicateCount > 0" type="warning" variant="tonal" class="mb-3">
            {{ duplicateCount }} of {{ fileCount }} files already exist as cases.
          </v-alert>

          <div v-if="duplicateCount > 0">
            <v-radio-group v-model="duplicateStrategy" class="mb-3" hide-details>
              <v-radio value="skip" color="primary">
                <template #label>
                  <div>
                    <strong>Skip duplicates</strong>
                    <div class="text-body-small text-medium-emphasis">
                      Only import new files, leave existing cases unchanged
                    </div>
                  </div>
                </template>
              </v-radio>
              <v-radio value="overwrite" color="warning">
                <template #label>
                  <div>
                    <strong>Overwrite duplicates</strong>
                    <div class="text-body-small text-medium-emphasis">
                      Replace existing cases with data from the selected files
                    </div>
                  </div>
                </template>
              </v-radio>
            </v-radio-group>
            <v-divider class="mb-3" />
          </div>

          <div class="text-body-small text-medium-emphasis mb-2">
            {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }} to import:
          </div>
          <v-list density="compact" class="pa-0" max-height="300" style="overflow-y: auto">
            <v-list-item
              v-for="(file, i) in reviewFiles"
              :key="i"
              :class="file.isDuplicate ? 'text-warning' : ''"
            >
              <template #prepend>
                <v-icon v-if="file.isDuplicate" color="warning" size="small">
                  mdi-alert-circle-outline
                </v-icon>
                <v-icon v-else color="success" size="small"> mdi-new-box </v-icon>
              </template>
              <v-list-item-title class="text-body-medium">
                {{ file.caseName }}
                <span v-if="file.isDuplicate" class="text-body-small text-warning ml-1">
                  (exists)
                </span>
              </v-list-item-title>
              <v-list-item-subtitle v-if="file.caseName !== file.fileName" class="text-body-small">
                {{ file.fileName }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <v-alert
            v-if="hasEmptyCaseNames"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-3"
          >
            Some case names are empty after stripping. Adjust the text to remove.
          </v-alert>
        </div>

        <!-- ZIP password phase -->
        <div v-if="phase === 'zip-password'">
          <div class="text-body-medium mb-4">This archive is password-protected.</div>
          <v-text-field
            v-model="zipPassword"
            label="Password"
            :type="showZipPassword ? 'text' : 'password'"
            :append-inner-icon="showZipPassword ? 'mdi-eye-off' : 'mdi-eye'"
            :error-messages="zipErrorMessage"
            autofocus
            @click:append-inner="showZipPassword = !showZipPassword"
            @keyup.enter="handleZipUnlock"
          />
        </div>

        <!-- Importing phase -->
        <div v-if="phase === 'importing'" class="mt-4">
          <div class="text-body-medium mb-2">
            Importing {{ currentFileName }} ({{ currentIndex + 1 }} of {{ totalFiles }})
          </div>
          <v-progress-linear :model-value="overallPercent" color="primary" height="25" class="mb-2">
            <template #default>{{ overallPercent }}%</template>
          </v-progress-linear>
          <div v-if="variantCount > 0" class="text-body-small">
            Variants processed: {{ variantCount.toLocaleString() }}
          </div>
        </div>

        <!-- Summary phase -->
        <div v-if="phase === 'summary'">
          <div class="d-flex gap-2 mb-4">
            <v-chip color="success" variant="flat">
              <v-icon start>mdi-check-circle</v-icon>
              Succeeded: {{ summary.succeeded }}
            </v-chip>
            <v-chip v-if="summary.failed > 0" color="error" variant="flat">
              <v-icon start>mdi-alert-circle</v-icon>
              Failed: {{ summary.failed }}
            </v-chip>
            <v-chip v-if="summary.skipped > 0" color="secondary" variant="flat">
              <v-icon start>mdi-skip-next</v-icon>
              Skipped: {{ summary.skipped }}
            </v-chip>
          </div>

          <v-alert v-if="summary.cancelled" type="info" class="mb-4">
            Import was cancelled. {{ summary.succeeded }} files were imported before cancellation.
          </v-alert>

          <v-expansion-panels v-if="summary.details.length > 0" variant="accordion">
            <v-expansion-panel v-for="(detail, i) in summary.details" :key="i">
              <v-expansion-panel-title>
                <div class="d-flex align-center gap-2">
                  <v-icon v-if="detail.status === 'success'" color="success" size="small">
                    mdi-check-circle
                  </v-icon>
                  <v-icon v-else-if="detail.status === 'failed'" color="error" size="small">
                    mdi-alert-circle
                  </v-icon>
                  <v-icon v-else color="secondary" size="small"> mdi-skip-next </v-icon>
                  <span>{{ detail.fileName }}</span>
                  <span v-if="detail.variantCount !== undefined" class="text-body-small ml-2">
                    ({{ detail.variantCount.toLocaleString() }} variants)
                  </span>
                </div>
              </v-expansion-panel-title>
              <v-expansion-panel-text>
                <div v-if="detail.status === 'success'">
                  <strong>Case:</strong> {{ detail.caseName }}<br />
                  <strong>Variants:</strong> {{ detail.variantCount?.toLocaleString() }} imported
                </div>
                <div v-else-if="detail.status === 'failed'">
                  <strong>Error:</strong> {{ detail.error }}
                </div>
                <div v-else><strong>Reason:</strong> {{ detail.error ?? 'Skipped' }}</div>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>
        </div>
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
