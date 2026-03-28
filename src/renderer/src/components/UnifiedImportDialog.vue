<template>
  <v-dialog v-model="dialog" max-width="650" :persistent="isActive" scrollable>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon :icon="mdiDatabaseImport" class="mr-2" />
        Import Data
        <v-spacer />
        <v-btn v-if="!isActive" icon variant="text" size="small" @click="close">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>
      <v-divider />

      <v-card-text v-if="phase === 'select'" class="pa-0">
        <!-- Source selection — clean card grid -->
        <div class="pa-4">
          <div class="text-caption text-medium-emphasis mb-3">Choose import source</div>
          <div class="d-flex flex-wrap ga-3">
            <v-card
              v-for="src in sources"
              :key="src.mode"
              variant="outlined"
              class="import-source-card flex-grow-1"
              :class="{ 'import-source-card--selected': selectedMode === src.mode }"
              min-width="140"
              @click="selectMode(src.mode)"
            >
              <v-card-text class="d-flex flex-column align-center text-center pa-3">
                <v-icon :icon="src.icon" size="28" color="primary" class="mb-2" />
                <div class="text-body-2 font-weight-medium">{{ src.title }}</div>
                <div class="text-caption text-medium-emphasis">{{ src.subtitle }}</div>
              </v-card-text>
            </v-card>
          </div>
        </div>
      </v-card-text>

      <!-- Single file mode — embedded form -->
      <v-card-text v-else-if="phase === 'single-form'">
        <v-alert v-if="singleError" type="error" density="compact" class="mb-3">
          {{ singleError }}
        </v-alert>
        <v-alert v-if="singleSuccess" type="success" density="compact" class="mb-3">
          Import complete!
        </v-alert>

        <div v-if="!singleSuccess">
          <v-text-field
            :model-value="singleFilePath"
            label="Selected File"
            readonly
            variant="outlined"
            density="compact"
            class="mb-2"
            @click="browseSingleFile"
          >
            <template #append-inner>
              <v-btn
                size="x-small"
                variant="text"
                :icon="mdiFolderOpen"
                :disabled="singleImporting"
                @click.stop="browseSingleFile"
              />
            </template>
          </v-text-field>

          <v-text-field
            v-model="singleCaseName"
            label="Case Name"
            :rules="caseNameRules"
            :disabled="singleImporting"
            variant="outlined"
            density="compact"
            class="mb-2"
          />
        </div>

        <div v-if="singleImporting" class="mt-2">
          <v-progress-linear indeterminate color="primary" height="20" class="mb-1" rounded />
          <div class="text-center text-caption">{{ singleProgressText }}</div>
        </div>
      </v-card-text>

      <!-- Batch mode — delegate to BatchImportDialog internals -->
      <v-card-text v-else-if="phase === 'batch-delegated'" class="text-center pa-6">
        <v-progress-circular indeterminate color="primary" size="32" />
        <div class="text-caption text-medium-emphasis mt-2">Opening file picker...</div>
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn
          v-if="phase !== 'select' && !singleImporting && !singleSuccess"
          variant="text"
          size="small"
          @click="backToSelect"
        >
          Back
        </v-btn>
        <v-spacer />
        <v-btn v-if="singleImporting" variant="text" size="small" @click="continueInBackground">
          Continue in Background
        </v-btn>
        <v-btn
          v-if="phase === 'single-form' && !singleSuccess"
          variant="text"
          size="small"
          @click="close"
        >
          Cancel
        </v-btn>
        <v-btn
          v-if="phase === 'single-form' && !singleImporting && !singleSuccess"
          color="primary"
          variant="flat"
          size="small"
          :disabled="!canImportSingle"
          @click="startSingleImport"
        >
          Import
        </v-btn>
        <v-btn v-if="singleSuccess" color="primary" variant="flat" size="small" @click="close">
          Done
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
import {
  mdiClose,
  mdiDatabaseImport,
  mdiFileDocument,
  mdiFileMultiple,
  mdiFolderOpen,
  mdiZipBox
} from '@mdi/js'

type ImportMode = 'single' | 'files' | 'folder' | 'zip'
type Phase = 'select' | 'single-form' | 'batch-delegated'

const { api } = useApiService()
const importStore = useImportStatusStore()

const emit = defineEmits<{
  'import-complete': [result: { caseId: number; variantCount: number; caseName: string }]
  'start-batch': [mode: 'files' | 'folder' | 'zip']
}>()

const dialog = ref(false)
const phase = ref<Phase>('select')
const selectedMode = ref<ImportMode | null>(null)

// Single import state
const singleFilePath = ref('')
const singleCaseName = ref('')
const singleImporting = ref(false)
const singleSuccess = ref(false)
const singleError = ref('')
const singleProgress = ref<ProgressUpdate>({ phase: 'reading', count: 0, elapsed: 0 })
const backgroundMode = ref(false)

let cleanupProgress: (() => void) | null = null

const sources = [
  {
    mode: 'single' as ImportMode,
    icon: mdiFileDocument,
    title: 'Single File',
    subtitle: 'JSON / JSON.GZ'
  },
  {
    mode: 'files' as ImportMode,
    icon: mdiFileMultiple,
    title: 'Multiple Files',
    subtitle: 'Select files'
  },
  {
    mode: 'folder' as ImportMode,
    icon: mdiFolderOpen,
    title: 'Folder',
    subtitle: 'All files in folder'
  },
  {
    mode: 'zip' as ImportMode,
    icon: mdiZipBox,
    title: 'ZIP Archive',
    subtitle: 'Extract & import'
  }
]

const isActive = computed(() => singleImporting.value)

const caseNameRules = [
  (v: string) => !!v || 'Case name is required',
  (v: string) => v.length >= 3 || 'Minimum 3 characters',
  (v: string) => v.length <= 50 || 'Maximum 50 characters'
]

const canImportSingle = computed(() => {
  if (singleFilePath.value === '' || singleCaseName.value === '') return false
  return caseNameRules.every((rule) => rule(singleCaseName.value) === true)
})

const singleProgressText = computed(() => {
  const labels: Record<string, string> = {
    reading: 'Reading file',
    parsing: 'Parsing variants',
    inserting: 'Inserting variants'
  }
  const label = labels[singleProgress.value.phase] ?? 'Processing'
  return `${label}... ${singleProgress.value.count.toLocaleString()}`
})

const extractCaseName = (path: string): string => {
  const parts = path.split(/[/\\]/)
  let name = parts[parts.length - 1] ?? 'import'
  if (name.endsWith('.gz')) name = name.slice(0, -3)
  if (name.endsWith('.json')) name = name.slice(0, -5)
  return name
}

function selectMode(mode: ImportMode): void {
  selectedMode.value = mode
  if (mode === 'single') {
    phase.value = 'single-form'
    browseSingleFile()
  } else {
    // For batch modes, close this dialog and delegate to BatchImportDialog
    dialog.value = false
    emit('start-batch', mode)
  }
}

function backToSelect(): void {
  phase.value = 'select'
  selectedMode.value = null
  singleError.value = ''
}

async function browseSingleFile(): Promise<void> {
  const path = await api!.import.selectFile()
  if (path !== null) {
    singleFilePath.value = path
    if (singleCaseName.value === '') {
      singleCaseName.value = extractCaseName(path)
    }
  }
}

async function startSingleImport(): Promise<void> {
  singleImporting.value = true
  singleError.value = ''
  backgroundMode.value = false
  singleProgress.value = { phase: 'reading', count: 0, elapsed: 0 }

  importStore.startImport(1)
  importStore.dialogOpen = true

  const result = await api!.import.start(singleFilePath.value, singleCaseName.value)

  singleImporting.value = false

  if (isIpcError(result)) {
    importStore.importError(result.userMessage)
    if (result.code === ErrorCode.UNIQUE_CONSTRAINT) {
      singleError.value = 'A case with this name already exists. Please choose a different name.'
    } else {
      singleError.value = result.userMessage
    }
  } else {
    const importResult = result as ImportResult
    importStore.importComplete({
      succeeded: 1,
      failed: 0,
      skipped: 0,
      cancelled: false,
      details: [
        {
          status: 'success' as const,
          caseName: singleCaseName.value,
          variantCount: importResult.variantCount,
          filePath: singleFilePath.value,
          fileName: singleFilePath.value.split(/[/\\]/).pop() ?? ''
        }
      ]
    })
    singleSuccess.value = true

    setTimeout(() => {
      close()
      emit('import-complete', {
        caseId: importResult.caseId,
        variantCount: importResult.variantCount,
        caseName: singleCaseName.value
      })
    }, 2000)
  }
}

function continueInBackground(): void {
  backgroundMode.value = true
  importStore.dialogOpen = false
  dialog.value = false
}

function close(): void {
  if (singleImporting.value) {
    continueInBackground()
    return
  }
  dialog.value = false
}

function resetState(): void {
  phase.value = 'select'
  selectedMode.value = null
  singleFilePath.value = ''
  singleCaseName.value = ''
  singleImporting.value = false
  singleSuccess.value = false
  singleError.value = ''
  backgroundMode.value = false
  singleProgress.value = { phase: 'reading', count: 0, elapsed: 0 }
}

const show = (): void => {
  resetState()
  dialog.value = true
}

const reopen = (): void => {
  if (singleImporting.value || backgroundMode.value) {
    backgroundMode.value = false
    importStore.dialogOpen = true
    dialog.value = true
  }
}

onMounted(() => {
  if (api) {
    cleanupProgress = api.import.onProgress((update: ProgressUpdate) => {
      singleProgress.value = update
      if (importStore.isActive) {
        importStore.updateProgress({
          fileIndex: 0,
          totalFiles: 1,
          fileName: singleFilePath.value.split(/[/\\]/).pop() ?? '',
          overallPercent: 0,
          phase: update.phase,
          skipped: 0,
          variantCount: update.count
        })
      }
    })
  }
})

onUnmounted(() => {
  cleanupProgress?.()
})

defineExpose({ show, reopen })
</script>

<style scoped>
.import-source-card {
  cursor: pointer;
  transition: all 0.15s ease;
  border-color: rgba(var(--v-border-color), var(--v-border-opacity));
}

.import-source-card:hover {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.04);
}

.import-source-card--selected {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
