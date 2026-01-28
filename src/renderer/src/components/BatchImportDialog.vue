<template>
  <v-dialog v-model="dialog" max-width="650" :persistent="phase === 'importing'">
    <v-card>
      <v-card-title>Batch Import</v-card-title>

      <v-card-text>
        <!-- Duplicate review phase (shown before import if duplicates found) -->
        <div v-if="phase === 'duplicate-review'">
          <v-alert type="warning" variant="tonal" class="mb-4">
            {{ duplicateCount }} of {{ fileCount }} selected files already exist as cases in the
            database.
          </v-alert>

          <div class="text-body-2 font-weight-medium mb-2">How should duplicates be handled?</div>
          <v-radio-group v-model="duplicateStrategy" class="mb-4">
            <v-radio value="skip" color="primary">
              <template #label>
                <div>
                  <strong>Skip duplicates</strong>
                  <div class="text-caption text-medium-emphasis">
                    Only import new files, leave existing cases unchanged
                  </div>
                </div>
              </template>
            </v-radio>
            <v-radio value="overwrite" color="warning">
              <template #label>
                <div>
                  <strong>Overwrite duplicates</strong>
                  <div class="text-caption text-medium-emphasis">
                    Replace existing cases with data from the selected files
                  </div>
                </div>
              </template>
            </v-radio>
          </v-radio-group>

          <v-divider class="mb-3" />
          <div class="text-caption text-medium-emphasis mb-2">Files to import:</div>
          <v-list density="compact" class="pa-0">
            <v-list-item
              v-for="(file, i) in duplicateCheckFiles"
              :key="i"
              :class="file.isDuplicate ? 'text-warning' : ''"
            >
              <template #prepend>
                <v-icon v-if="file.isDuplicate" color="warning" size="small">
                  mdi-alert-circle-outline
                </v-icon>
                <v-icon v-else color="success" size="small"> mdi-new-box </v-icon>
              </template>
              <v-list-item-title class="text-body-2">
                {{ file.fileName }}
                <span v-if="file.isDuplicate" class="text-caption text-warning ml-1">
                  (exists)
                </span>
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </div>

        <!-- ZIP password phase -->
        <div v-if="phase === 'zip-password'">
          <div class="text-body-2 mb-4">This archive is password-protected.</div>
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

        <!-- ZIP preview phase -->
        <div v-if="phase === 'zip-preview'">
          <div class="text-body-2 mb-2">
            {{ extractedFilePaths.length }} file{{ extractedFilePaths.length !== 1 ? 's' : '' }}
            ready to import:
          </div>
          <v-list density="compact" class="pa-0 mb-3" max-height="300" style="overflow-y: auto">
            <v-list-item v-for="(fp, i) in extractedFilePaths" :key="i">
              <template #prepend>
                <v-icon color="success" size="small">mdi-file-check</v-icon>
              </template>
              <v-list-item-title class="text-body-2">
                {{ fp.split('/').pop() ?? fp.split('\\').pop() ?? fp }}
              </v-list-item-title>
            </v-list-item>
          </v-list>
          <v-alert
            v-if="zipExtractionErrors.length > 0"
            type="warning"
            variant="tonal"
            class="mb-3"
          >
            <div class="text-body-2 font-weight-medium mb-1">Extraction warnings:</div>
            <div v-for="(err, i) in zipExtractionErrors" :key="i" class="text-caption">
              {{ err }}
            </div>
          </v-alert>
        </div>

        <!-- Importing phase -->
        <div v-if="phase === 'importing'" class="mt-4">
          <div class="text-body-2 mb-2">
            Importing {{ currentFileName }} ({{ currentIndex + 1 }} of {{ totalFiles }})
          </div>
          <v-progress-linear :model-value="overallPercent" color="primary" height="25" class="mb-2">
            <template #default>{{ overallPercent }}%</template>
          </v-progress-linear>
          <div v-if="variantCount > 0" class="text-caption">
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
                  <span v-if="detail.variantCount !== undefined" class="text-caption ml-2">
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
        <v-btn v-if="phase === 'duplicate-review'" variant="text" @click="closeDialog">
          Cancel
        </v-btn>
        <v-btn
          v-if="phase === 'duplicate-review'"
          color="primary"
          variant="flat"
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
        <v-btn v-if="phase === 'zip-preview'" variant="text" @click="handleZipCancel">
          Cancel
        </v-btn>
        <v-btn
          v-if="phase === 'zip-preview'"
          color="primary"
          variant="flat"
          @click="startZipImport"
        >
          Start Import
        </v-btn>
        <v-btn v-if="phase === 'importing'" @click="handleCancel"> Cancel </v-btn>
        <v-btn v-if="phase === 'summary'" @click="handleCancel"> Close </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type {
  BatchProgress,
  BatchResult,
  DuplicateChoice,
  DuplicateCheckItem
} from '../../../shared/types/api'

type Phase = 'idle' | 'duplicate-review' | 'importing' | 'summary' | 'zip-password' | 'zip-preview'

const dialog = ref(false)
const phase = ref<Phase>('idle')

// File selection state
const selectedFilePaths = ref<string[]>([])

// Duplicate check state
const duplicateCheckFiles = ref<DuplicateCheckItem[]>([])
const duplicateCount = ref(0)
const fileCount = ref(0)
const duplicateStrategy = ref<DuplicateChoice>('skip')

// ZIP state
const zipPath = ref('')
const zipPassword = ref('')
const showZipPassword = ref(false)
const zipErrorMessage = ref('')
const testingPassword = ref(false)
const extractedFilePaths = ref<string[]>([])
const zipExtractionErrors = ref<string[]>([])

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
 * Show dialog and start the batch import flow
 */
const show = async (mode: 'files' | 'folder' | 'zip'): Promise<void> => {
  // Reset all state
  resetState()

  if (mode === 'zip') {
    // eslint-disable-next-line no-undef
    const result = await window.api.batchImport.selectZip()
    if (result === null) return

    zipPath.value = result.filePath
    dialog.value = true

    if (result.isEncrypted === true) {
      phase.value = 'zip-password'
    } else {
      await extractAndPreview(result.filePath)
    }
    return
  }

  let filePaths: string[] = []

  // Select files based on mode
  if (mode === 'files') {
    // eslint-disable-next-line no-undef
    filePaths = await window.api.batchImport.selectFiles()
  } else {
    // eslint-disable-next-line no-undef
    filePaths = await window.api.batchImport.selectFolder()
  }

  // User cancelled or no files found
  if (filePaths.length === 0) {
    return
  }

  selectedFilePaths.value = filePaths
  fileCount.value = filePaths.length
  dialog.value = true

  // Check for duplicates before importing
  // eslint-disable-next-line no-undef
  const checkResult = await window.api.batchImport.checkDuplicates(filePaths)

  if (checkResult.duplicateCount > 0) {
    // Duplicates found — show review phase
    duplicateCheckFiles.value = checkResult.files
    duplicateCount.value = checkResult.duplicateCount
    phase.value = 'duplicate-review'
  } else {
    // No duplicates — start importing immediately
    phase.value = 'importing'
    await startImport(filePaths, 'skip')
  }
}

/**
 * User confirmed strategy in duplicate-review phase, start import
 */
const confirmAndStartImport = async (): Promise<void> => {
  phase.value = 'importing'
  // Spread to plain array — Vue reactive Proxy can't be structured-cloned by Electron IPC
  await startImport([...selectedFilePaths.value], duplicateStrategy.value)
}

/**
 * Start the batch import process
 */
const startImport = async (filePaths: string[], strategy: DuplicateChoice): Promise<void> => {
  totalFiles.value = filePaths.length

  try {
    // eslint-disable-next-line no-undef
    const result = await window.api.batchImport.start(filePaths, strategy)

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
 * Extract ZIP and show preview of files
 */
const extractAndPreview = async (zipFilePath: string, password?: string): Promise<void> => {
  try {
    // eslint-disable-next-line no-undef
    const result = await window.api.batchImport.extractZip(zipFilePath, password)
    extractedFilePaths.value = result.files
    zipExtractionErrors.value = result.errors

    if (result.files.length === 0) {
      zipErrorMessage.value = 'No importable files found in archive.'
      if (result.errors.length > 0) {
        zipErrorMessage.value += ' Errors: ' + result.errors.join('; ')
      }
      // eslint-disable-next-line no-undef
      await window.api.batchImport.cleanupZipTemp()
      return
    }

    phase.value = 'zip-preview'
  } catch (error) {
    zipErrorMessage.value = error instanceof Error ? error.message : 'Failed to extract archive'
    // eslint-disable-next-line no-undef
    await window.api.batchImport.cleanupZipTemp()
  }
}

/**
 * Test ZIP password and extract if correct
 */
const handleZipUnlock = async (): Promise<void> => {
  testingPassword.value = true
  zipErrorMessage.value = ''

  try {
    // eslint-disable-next-line no-undef
    const result = await window.api.batchImport.testZipPassword(zipPath.value, zipPassword.value)
    if (result.success === true) {
      await extractAndPreview(zipPath.value, zipPassword.value)
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
 * Start importing extracted ZIP files
 */
const startZipImport = async (): Promise<void> => {
  phase.value = 'importing'
  totalFiles.value = extractedFilePaths.value.length

  try {
    // Spread to plain array to avoid Vue reactive Proxy IPC issue
    // eslint-disable-next-line no-undef
    const batchResult = await window.api.batchImport.start(
      [...extractedFilePaths.value],
      'skip' // ZIP files are freshly extracted, no duplicates expected - default to skip
    )
    summary.value = batchResult
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
          fileName: 'ZIP Import',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      ]
    }
    phase.value = 'summary'
  } finally {
    // Always clean up temp directory
    // eslint-disable-next-line no-undef
    await window.api.batchImport.cleanupZipTemp()
  }
}

/**
 * Cancel ZIP flow and clean up temp directory
 */
const handleZipCancel = async (): Promise<void> => {
  // eslint-disable-next-line no-undef
  await window.api.batchImport.cleanupZipTemp()
  dialog.value = false
}

/**
 * Handle cancel/close button
 */
const handleCancel = async (): Promise<void> => {
  if (phase.value === 'importing') {
    // eslint-disable-next-line no-undef
    await window.api.batchImport.cancel()
  } else if (phase.value === 'summary') {
    dialog.value = false
    // Cleanup temp directory in case it's a ZIP import (idempotent)
    // eslint-disable-next-line no-undef
    await window.api.batchImport.cleanupZipTemp()

    if (summary.value.succeeded > 0) {
      emit('batch-import-complete', { totalImported: summary.value.succeeded })
    }
  }
}

/**
 * Close dialog without importing
 */
const closeDialog = (): void => {
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
  extractedFilePaths.value = []
  zipExtractionErrors.value = []
}

// Setup IPC listeners
onMounted(() => {
  // eslint-disable-next-line no-undef
  cleanupProgress = window.api.batchImport.onProgress((progress: BatchProgress) => {
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
})

// Define emits
const emit = defineEmits<{
  'batch-import-complete': [payload: { totalImported: number }]
}>()

// Expose show method to parent
defineExpose({ show })
</script>
