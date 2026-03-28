<template>
  <v-dialog v-model="dialog" max-width="600" :persistent="isImporting">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon :icon="mdiFileImport" class="mr-2" />
        Import Variant Data
        <v-spacer />
        <v-btn v-if="!isImporting" icon variant="text" size="small" @click="handleCancel">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <!-- Error display -->
        <v-alert v-if="errorMessage" type="error" class="mb-4">
          {{ errorMessage }}
        </v-alert>

        <!-- Success display -->
        <v-alert v-if="isSuccess" type="success" class="mb-4">
          <div class="d-flex align-center">
            <v-icon class="mr-2" :icon="mdiCheckCircle" />
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
            <v-icon class="mr-2" :icon="mdiFolderOpen" />
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
          <div class="text-center text-body-medium">
            {{ progressText }}
          </div>
        </div>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn v-if="isImporting" variant="text" @click="continueInBackground">
          Continue in Background
        </v-btn>
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
import { useApiService } from '../composables/useApiService'
import { useImportStatusStore } from '../stores/importStatusStore'
import { mdiCheckCircle, mdiClose, mdiFileImport, mdiFolderOpen } from '@mdi/js'

const { api } = useApiService()
const importStore = useImportStatusStore()

const dialog = ref(false)
const filePath = ref('')
const caseName = ref('')
const isImporting = ref(false)
const isSuccess = ref(false)
const errorMessage = ref('')
const progress = ref<ProgressUpdate>({ phase: 'reading', count: 0, elapsed: 0 })
const backgroundMode = ref(false)

let cleanupProgress: (() => void) | null = null

const caseNameRules = [
  (v: string) => !!v || 'Case name is required',
  (v: string) => v.length >= 3 || 'Minimum 3 characters',
  (v: string) => v.length <= 50 || 'Maximum 50 characters'
]

const canImport = computed(() => {
  if (filePath.value === '' || caseName.value === '') return false
  return caseNameRules.every((rule) => rule(caseName.value) === true)
})

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

const extractCaseName = (path: string): string => {
  const parts = path.split(/[/\\]/)
  let name = parts[parts.length - 1] ?? 'import'
  if (name.endsWith('.gz') === true) name = name.slice(0, -3)
  if (name.endsWith('.json') === true) name = name.slice(0, -5)
  return name
}

const handleBrowse = async (): Promise<void> => {
  const selectedPath = await api!.import.selectFile()
  if (selectedPath !== null) {
    filePath.value = selectedPath
    if (caseName.value === '') {
      caseName.value = extractCaseName(selectedPath)
    }
  }
}

const handleImport = async (): Promise<void> => {
  isImporting.value = true
  errorMessage.value = ''
  backgroundMode.value = false
  progress.value = { phase: 'reading', count: 0, elapsed: 0 }

  importStore.startImport(1)
  importStore.dialogOpen = true

  const result = await api!.import.start(filePath.value, caseName.value)

  isImporting.value = false

  if (isIpcError(result)) {
    importStore.importError(result.userMessage)
    if (result.code === ErrorCode.UNIQUE_CONSTRAINT) {
      errorMessage.value = 'A case with this name already exists. Please choose a different name.'
    } else {
      errorMessage.value = result.userMessage
    }
  } else {
    importStore.importComplete({
      succeeded: 1,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: []
    })

    if (backgroundMode.value) {
      // Dialog was dismissed — emit completion without showing success UI
      emit('import-complete', {
        caseId: result.caseId,
        variantCount: result.variantCount,
        caseName: caseName.value
      })
    } else {
      showSuccessAndClose(result)
    }
  }
}

const continueInBackground = (): void => {
  backgroundMode.value = true
  importStore.dialogOpen = false
  dialog.value = false
}

const handleCancel = async (): Promise<void> => {
  if (isImporting.value === true) {
    await api!.import.cancel()
    isImporting.value = false
    importStore.reset()
  }
  dialog.value = false
}

const showSuccessAndClose = (result: ImportResult): void => {
  isSuccess.value = true

  setTimeout(() => {
    dialog.value = false
    isSuccess.value = false

    emit('import-complete', {
      caseId: result.caseId,
      variantCount: result.variantCount,
      caseName: caseName.value
    })
  }, 3000)
}

const show = async (): Promise<void> => {
  dialog.value = true
  filePath.value = ''
  caseName.value = ''
  isImporting.value = false
  isSuccess.value = false
  errorMessage.value = ''
  backgroundMode.value = false
  progress.value = { phase: 'reading', count: 0, elapsed: 0 }

  await handleBrowse()
}

onMounted(() => {
  cleanupProgress = api!.import.onProgress((update: ProgressUpdate) => {
    progress.value = update
    if (importStore.isActive) {
      importStore.updateProgress({
        fileIndex: 0,
        totalFiles: 1,
        fileName: filePath.value.split(/[/\\]/).pop() ?? '',
        overallPercent:
          (update.phase as string) === 'finalizing'
            ? 99
            : update.phase === 'inserting'
              ? 90
              : update.phase === 'parsing'
                ? 50
                : 10,
        phase: update.phase,
        variantCount: update.count,
        skipped: 0
      })
    }
  })
})

onUnmounted(() => {
  cleanupProgress?.()
})

const emit = defineEmits<{
  'import-complete': [payload: { caseId: number; variantCount: number; caseName: string }]
}>()

const reopen = (): void => {
  if (isImporting.value) {
    dialog.value = true
  }
}

defineExpose({ show, reopen })
</script>
