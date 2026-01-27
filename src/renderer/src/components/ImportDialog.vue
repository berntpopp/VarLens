<template>
  <v-dialog v-model="dialog" max-width="500" :persistent="isImporting">
    <v-card>
      <v-card-title>Import Variant Data</v-card-title>
      <v-card-text>
        <!-- Error display -->
        <v-alert v-if="errorMessage" type="error" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <!-- Success display -->
        <v-alert v-if="isSuccess" type="success" class="mb-4">
          <div class="d-flex align-center">
            <v-icon class="mr-2">mdi-check-circle</v-icon>
            <span>Import complete!</span>
          </div>
        </v-alert>

        <!-- File selection display -->
        <div v-if="!isSuccess" class="mb-4">
          <v-text-field
            :model-value="filePath"
            label="Selected File"
            readonly
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          <v-btn :disabled="isImporting" color="primary" variant="outlined" @click="handleBrowse">
            <v-icon class="mr-2">mdi-folder-open</v-icon>
            Browse
          </v-btn>
        </div>

        <!-- Case name input -->
        <v-text-field
          v-if="!isSuccess"
          v-model="caseName"
          label="Case Name"
          :rules="caseNameRules"
          :disabled="isImporting"
          variant="outlined"
          density="comfortable"
          class="mb-2"
        />

        <!-- Progress section -->
        <div v-if="isImporting" class="mt-4">
          <v-progress-linear indeterminate color="primary" height="25" class="mb-2" />
          <div class="text-center text-body-2">
            {{ progressText }}
          </div>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="isSuccess" @click="handleCancel">
          {{ isImporting ? 'Cancel' : 'Close' }}
        </v-btn>
        <v-btn
          v-if="!isImporting && !isSuccess"
          color="primary"
          :disabled="!canImport"
          @click="handleImport"
        >
          Import
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ProgressUpdate, ImportResult } from '../../../shared/types/api'
import { isIpcError, ErrorCode } from '../../../shared/types/errors'

const dialog = ref(false)
const filePath = ref('')
const caseName = ref('')
const isImporting = ref(false)
const isSuccess = ref(false)
const errorMessage = ref('')
const progress = ref<ProgressUpdate>({ phase: 'reading', count: 0, elapsed: 0 })

let cleanupProgress: (() => void) | null = null

// Validation rules for case name
const caseNameRules = [
  (v: string) => !!v || 'Case name is required',
  (v: string) => v.length >= 3 || 'Minimum 3 characters',
  (v: string) => v.length <= 50 || 'Maximum 50 characters'
]

// Check if import button should be enabled
const canImport = computed(() => {
  if (filePath.value === '' || caseName.value === '') return false
  // Validate case name meets all rules
  return caseNameRules.every((rule) => rule(caseName.value) === true)
})

// Format progress text
const progressText = computed(() => {
  const phaseLabels: Record<string, string> = {
    reading: 'Reading file',
    parsing: 'Parsing variants',
    inserting: 'Inserting variants'
  }
  const phaseLabel = phaseLabels[progress.value.phase] ?? 'Processing'

  const count = progress.value.count.toLocaleString()
  return `${phaseLabel}... ${count}`
})

// Extract case name from file path
const extractCaseName = (path: string): string => {
  const parts = path.split('/')
  let name = parts[parts.length - 1]
  if (name === undefined || name === '') {
    const backslashParts = path.split('\\')
    name = backslashParts[backslashParts.length - 1] ?? 'import'
  }
  if (name.endsWith('.gz') === true) name = name.slice(0, -3)
  if (name.endsWith('.json') === true) name = name.slice(0, -5)
  return name
}

// Open file browser and populate file path
const handleBrowse = async (): Promise<void> => {
  // eslint-disable-next-line no-undef
  const selectedPath = await window.api.import.selectFile()
  if (selectedPath !== null) {
    filePath.value = selectedPath
    // Auto-populate case name if empty
    if (caseName.value === '') {
      caseName.value = extractCaseName(selectedPath)
    }
  }
}

// Start import process
const handleImport = async (): Promise<void> => {
  isImporting.value = true
  errorMessage.value = ''
  progress.value = { phase: 'reading', count: 0, elapsed: 0 }

  // eslint-disable-next-line no-undef
  const result = await window.api.import.start(filePath.value, caseName.value)

  isImporting.value = false

  if (isIpcError(result)) {
    // Handle error
    if (result.code === ErrorCode.UNIQUE_CONSTRAINT) {
      errorMessage.value = 'A case with this name already exists. Please choose a different name.'
    } else {
      errorMessage.value = result.userMessage
    }
  } else {
    // Success
    showSuccessAndClose(result)
  }
}

// Handle cancel/close
const handleCancel = async (): Promise<void> => {
  if (isImporting.value === true) {
    // Cancel active import
    // eslint-disable-next-line no-undef
    await window.api.import.cancel()
    isImporting.value = false
  }
  dialog.value = false
}

// Show success state and auto-close
const showSuccessAndClose = (result: ImportResult): void => {
  isSuccess.value = true

  // eslint-disable-next-line no-undef
  setTimeout(() => {
    dialog.value = false
    isSuccess.value = false

    // Emit event to parent
    emit('import-complete', {
      caseId: result.caseId,
      variantCount: result.variantCount,
      caseName: caseName.value
    })
  }, 1500) // 1.5 second delay
}

// Show dialog and optionally trigger file selection
const show = async (): Promise<void> => {
  // Reset state
  dialog.value = true
  filePath.value = ''
  caseName.value = ''
  isImporting.value = false
  isSuccess.value = false
  errorMessage.value = ''
  progress.value = { phase: 'reading', count: 0, elapsed: 0 }

  // Immediately trigger file selection
  await handleBrowse()
}

// Setup IPC progress listener
onMounted(() => {
  // eslint-disable-next-line no-undef
  cleanupProgress = window.api.import.onProgress((update: ProgressUpdate) => {
    progress.value = update
  })
})

// Cleanup IPC listener
onUnmounted(() => {
  cleanupProgress?.()
})

// Define emits
const emit = defineEmits<{
  'import-complete': [payload: { caseId: number; variantCount: number; caseName: string }]
}>()

// Expose show method to parent
defineExpose({ show })
</script>
