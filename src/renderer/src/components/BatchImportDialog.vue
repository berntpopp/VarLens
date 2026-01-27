<template>
  <v-dialog v-model="dialog" max-width="650" :persistent="phase === 'importing'">
    <v-card>
      <v-card-title>Batch Import</v-card-title>

      <v-card-text>
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

        <!-- Duplicate prompt phase -->
        <div v-if="phase === 'duplicate-prompt'">
          <v-alert type="warning" class="mb-4">
            A case named '{{ duplicatePrompt.caseName }}' already exists.
          </v-alert>
          <div class="text-body-2 mb-4">File: {{ duplicatePrompt.fileName }}</div>
          <v-checkbox
            v-model="applyToAll"
            label="Apply this choice to all remaining duplicates"
            density="compact"
            hide-details
            class="mb-4"
          />
        </div>

        <!-- Summary phase -->
        <div v-if="phase === 'summary'">
          <div class="d-flex gap-2 mb-4">
            <v-chip color="success" variant="flat">
              <v-icon start>mdi-check-circle</v-icon>
              Succeeded: {{ summary.succeeded }}
            </v-chip>
            <v-chip color="error" variant="flat">
              <v-icon start>mdi-alert-circle</v-icon>
              Failed: {{ summary.failed }}
            </v-chip>
            <v-chip color="secondary" variant="flat">
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
        <!-- Cancel/Close button -->
        <v-btn v-if="phase === 'importing' || phase === 'summary'" @click="handleCancel">
          {{ phase === 'importing' ? 'Cancel' : 'Close' }}
        </v-btn>

        <!-- Duplicate prompt buttons -->
        <template v-if="phase === 'duplicate-prompt'">
          <v-btn variant="outlined" @click="handleDuplicateChoice('skip')"> Skip </v-btn>
          <v-btn color="warning" @click="handleDuplicateChoice('overwrite')"> Overwrite </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type {
  BatchProgress,
  BatchResult,
  DuplicatePrompt,
  DuplicateChoice
} from '../../../shared/types/api'

type Phase = 'idle' | 'importing' | 'duplicate-prompt' | 'summary'

const dialog = ref(false)
const phase = ref<Phase>('idle')

// Progress state
const currentIndex = ref(0)
const totalFiles = ref(0)
const currentFileName = ref('')
const overallPercent = ref(0)
const variantCount = ref(0)

// Duplicate prompt state
const duplicatePrompt = ref<DuplicatePrompt>({ fileName: '', caseName: '' })
const applyToAll = ref(false)

// Summary state
const summary = ref<BatchResult>({
  succeeded: 0,
  failed: 0,
  skipped: 0,
  cancelled: false,
  details: []
})

// Cleanup functions for IPC listeners
let cleanupProgress: (() => void) | null = null
let cleanupDuplicatePrompt: (() => void) | null = null

/**
 * Show dialog and start import based on mode
 */
const show = async (mode: 'files' | 'folder'): Promise<void> => {
  // Reset state
  dialog.value = true
  phase.value = 'importing'
  currentIndex.value = 0
  totalFiles.value = 0
  currentFileName.value = ''
  overallPercent.value = 0
  variantCount.value = 0
  applyToAll.value = false

  let filePaths: string[] = []

  // Select files based on mode
  if (mode === 'files') {
    // eslint-disable-next-line no-undef
    filePaths = await window.api.batchImport.selectFiles()
  } else {
    // eslint-disable-next-line no-undef
    filePaths = await window.api.batchImport.selectFolder()
  }

  // Check if user cancelled or no files found
  if (filePaths.length === 0) {
    // User cancelled or no files found
    dialog.value = false
    return
  }

  // Start import
  await startImport(filePaths)
}

/**
 * Start the batch import process
 */
const startImport = async (filePaths: string[]): Promise<void> => {
  totalFiles.value = filePaths.length

  try {
    // eslint-disable-next-line no-undef
    const result = await window.api.batchImport.start(filePaths)

    // Import complete - show summary
    summary.value = result
    phase.value = 'summary'
  } catch (error) {
    // Show error summary
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
 * Handle cancel/close button
 */
const handleCancel = async (): Promise<void> => {
  if (phase.value === 'importing') {
    // Cancel active import
    // eslint-disable-next-line no-undef
    await window.api.batchImport.cancel()
  } else if (phase.value === 'summary') {
    // Close dialog and emit completion event
    dialog.value = false

    // Emit batch import complete with total succeeded count
    if (summary.value.succeeded > 0) {
      emit('batch-import-complete', { totalImported: summary.value.succeeded })
    }
  }
}

/**
 * Handle duplicate choice (skip or overwrite)
 */
const handleDuplicateChoice = async (choice: DuplicateChoice): Promise<void> => {
  // eslint-disable-next-line no-undef
  await window.api.batchImport.resolveDuplicate(choice, applyToAll.value)

  // Reset duplicate prompt state
  applyToAll.value = false

  // Return to importing phase
  phase.value = 'importing'
}

// Setup IPC listeners
onMounted(() => {
  // Progress listener
  // eslint-disable-next-line no-undef
  cleanupProgress = window.api.batchImport.onProgress((progress: BatchProgress) => {
    currentIndex.value = progress.currentIndex
    totalFiles.value = progress.totalFiles
    currentFileName.value = progress.currentFileName
    overallPercent.value = progress.overallPercent

    // Update variant count from file progress if available
    if (progress.fileProgress !== undefined) {
      variantCount.value = progress.fileProgress.count
    }
  })

  // Duplicate prompt listener
  // eslint-disable-next-line no-undef
  cleanupDuplicatePrompt = window.api.batchImport.onDuplicatePrompt((prompt: DuplicatePrompt) => {
    duplicatePrompt.value = prompt
    phase.value = 'duplicate-prompt'
  })
})

// Cleanup IPC listeners
onUnmounted(() => {
  cleanupProgress?.()
  cleanupDuplicatePrompt?.()
})

// Define emits
const emit = defineEmits<{
  'batch-import-complete': [payload: { totalImported: number }]
}>()

// Expose show method to parent
defineExpose({ show })
</script>
