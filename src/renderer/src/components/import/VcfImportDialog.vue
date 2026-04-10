<template>
  <v-dialog
    :model-value="open"
    :persistent="phase === 'progress'"
    max-width="960"
    scrollable
    transition="dialog-bottom-transition"
    @update:model-value="onDialogUpdate"
    @keydown.esc="handleEsc"
  >
    <v-card class="vcf-import-dialog">
      <v-card-title class="d-flex align-center pa-4">
        <v-icon :icon="mdiFileDocumentMultiple" class="mr-2" color="primary" />
        <span class="text-h6">Import VCF Files</span>
        <v-spacer />
        <!-- Phase indicator -->
        <div class="d-flex align-center ga-1 mr-2">
          <v-chip
            v-for="(label, idx) in phaseLabels"
            :key="label"
            :color="idx <= currentPhaseIndex ? 'primary' : undefined"
            :variant="
              idx === currentPhaseIndex ? 'flat' : idx < currentPhaseIndex ? 'tonal' : 'outlined'
            "
            size="x-small"
            label
          >
            {{ idx + 1 }}. {{ label }}
          </v-chip>
        </div>
        <v-btn
          icon
          size="small"
          variant="text"
          :disabled="phase === 'progress'"
          @click="handleClose"
        >
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>

      <v-divider />

      <!-- Top-level error alert -->
      <v-alert
        v-if="errorMessage !== null"
        type="error"
        variant="tonal"
        closable
        class="ma-4 mb-0"
        @click:close="errorMessage = null"
      >
        {{ errorMessage }}
      </v-alert>

      <!-- =========================================================== -->
      <!-- PHASE: SELECT                                                -->
      <!-- =========================================================== -->
      <v-card-text v-if="phase === 'select'" class="pa-6">
        <div
          class="drop-zone pa-8 text-center rounded"
          :class="{ 'drop-zone--active': isDragging, 'drop-zone--loading': previewLoading }"
          @drop.prevent="handleDrop"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
        >
          <div v-if="previewLoading" class="d-flex flex-column align-center">
            <v-progress-circular indeterminate color="primary" size="48" />
            <div class="text-body-1 mt-3">Analyzing {{ pendingFileCount }} file(s)…</div>
          </div>
          <div v-else>
            <v-icon :icon="mdiCloudUploadOutline" size="64" color="primary" />
            <div class="text-h6 mt-3">Drop VCF files here</div>
            <div class="text-body-2 text-medium-emphasis">or</div>
            <v-btn
              color="primary"
              class="mt-3"
              variant="flat"
              :prepend-icon="mdiFolderOpen"
              @click="browseFiles"
            >
              Browse files
            </v-btn>
            <div class="text-caption mt-3 text-medium-emphasis">
              Supports <code>.vcf</code> and <code>.vcf.gz</code> files (SNV/Indel, SV, CNV, STR)
            </div>
            <div class="text-caption text-medium-emphasis">
              Multiple files for the same case (e.g. SNV + SV + CNV) will be merged into one case.
            </div>
          </div>
        </div>
      </v-card-text>

      <!-- =========================================================== -->
      <!-- PHASE: REVIEW                                                -->
      <!-- =========================================================== -->
      <v-card-text v-else-if="phase === 'review'" class="pa-4">
        <v-alert
          v-if="previewResult !== null"
          :icon="mdiCheckCircle"
          color="success"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          Detected {{ previewResult.files.length }} VCF file(s){{
            pipelineLabel !== null ? ` — ${pipelineLabel} pipeline` : ''
          }}
        </v-alert>

        <v-text-field
          v-model="caseName"
          label="Case name"
          density="comfortable"
          variant="outlined"
          :prepend-inner-icon="mdiFolderOutline"
          class="mb-3"
          :error-messages="caseNameError"
          autofocus
        />

        <VcfFileList
          :files="previewResult?.files ?? []"
          :overrides="overrides"
          @update:override="handleOverride"
        />

        <v-alert
          v-if="hasLargeFiles"
          :icon="mdiAlertCircleOutline"
          color="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          {{ largeFilesMessage }}
        </v-alert>

        <v-alert
          v-if="suggestedBedFile !== null && !isBedApplied"
          :icon="mdiLightbulbOutline"
          color="info"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          Found <code>{{ fileName(suggestedBedFile) }}</code> in the same folder. Use it as a region
          filter?
          <template #append>
            <v-btn size="small" variant="tonal" @click="useSuggestedBed">Use as filter</v-btn>
          </template>
        </v-alert>

        <v-expansion-panels variant="accordion" class="mt-3" multiple>
          <v-expansion-panel>
            <v-expansion-panel-title>
              <div class="d-flex align-center ga-2">
                <v-icon :icon="mdiTune" size="18" />
                Advanced options
                <v-chip
                  v-if="hasFiltersApplied"
                  size="x-small"
                  color="primary"
                  variant="tonal"
                  label
                >
                  {{ activeFilterCount }} active
                </v-chip>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <ImportFilterOptions
                :filters="filters"
                :suggested-bed-files="previewResult?.siblingBedFiles ?? []"
                @update:filters="filters = $event"
              />
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <!-- =========================================================== -->
      <!-- PHASE: PROGRESS                                              -->
      <!-- =========================================================== -->
      <v-card-text v-else-if="phase === 'progress'" class="pa-4">
        <ImportProgressView
          :files="previewResult?.files ?? []"
          :statuses="fileStatuses"
          :current-file="currentFile"
          :overall-percent="overallPercent"
        />
      </v-card-text>

      <!-- =========================================================== -->
      <!-- PHASE: SUMMARY                                               -->
      <!-- =========================================================== -->
      <v-card-text v-else-if="phase === 'summary' && importResult !== null" class="pa-4">
        <ImportSummaryView
          :result="importResult"
          :case-name="caseName"
          :file-results="previewResult?.files ?? []"
          @view-case="handleViewCase"
          @import-more="resetToSelect"
          @close="handleClose"
        />
      </v-card-text>

      <v-divider v-if="phase === 'review'" />

      <v-card-actions v-if="phase === 'review'" class="pa-3">
        <v-btn variant="text" @click="resetToSelect">Back</v-btn>
        <v-spacer />
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!canImport"
          :prepend-icon="mdiDatabaseImport"
          @click="startImport"
        >
          Import {{ previewResult?.files.length ?? 0 }} file{{
            (previewResult?.files.length ?? 0) === 1 ? '' : 's'
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import type {
  MultiFileImportResult,
  MultiFileImportSpec,
  ProgressUpdate
} from '../../../../shared/types/api'
import type { VcfMultiPreviewResult } from '../../../../shared/types/import'
import { isIpcError } from '../../../../shared/types/errors'
import { useApiService } from '../../composables/useApiService'
import { useAppState } from '../../composables/useAppState'
import { logService } from '../../services/LogService'
import VcfFileList, { type VariantTypeOverride } from './VcfFileList.vue'
import ImportFilterOptions, { type ImportFilterState } from './ImportFilterOptions.vue'
import ImportProgressView, { type FileStatusEntry } from './ImportProgressView.vue'
import ImportSummaryView from './ImportSummaryView.vue'
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiClose,
  mdiCloudUploadOutline,
  mdiDatabaseImport,
  mdiFileDocumentMultiple,
  mdiFolderOpen,
  mdiFolderOutline,
  mdiLightbulbOutline,
  mdiTune
} from '@mdi/js'

type Phase = 'select' | 'review' | 'progress' | 'summary'

const LARGE_FILE_THRESHOLD = 100_000

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  close: []
  'case-imported': [result: { caseId: number; caseName: string; variantCount: number }]
}>()

const { api } = useApiService()
const router = useRouter()
const { selectedCaseId, selectedCaseName, selectedVariantCount, selectedCreatedAt, activeTab } =
  useAppState()

// ---------------------------------------------------------------------------
// Phase state
// ---------------------------------------------------------------------------
const phase = ref<Phase>('select')
const errorMessage = ref<string | null>(null)

const phaseLabels = ['Select', 'Review', 'Import', 'Done']
const currentPhaseIndex = computed<number>(() => {
  switch (phase.value) {
    case 'select':
      return 0
    case 'review':
      return 1
    case 'progress':
      return 2
    case 'summary':
      return 3
    default:
      return 0
  }
})

// ---------------------------------------------------------------------------
// Select phase
// ---------------------------------------------------------------------------
const isDragging = ref(false)
const previewLoading = ref(false)
const pendingFileCount = ref(0)

// ---------------------------------------------------------------------------
// Review phase
// ---------------------------------------------------------------------------
const previewResult = ref<VcfMultiPreviewResult | null>(null)
const caseName = ref('')
const overrides = ref(new Map<string, VariantTypeOverride>())
const filters = ref<ImportFilterState>({
  passOnly: false,
  minQual: null,
  minGq: null,
  minDp: null,
  bedPath: undefined,
  bedPadding: 50
})

const caseNameError = computed<string[]>(() => {
  if (phase.value !== 'review') return []
  if (caseName.value.trim() === '') return ['Case name is required']
  return []
})

const canImport = computed(
  () =>
    phase.value === 'review' &&
    caseName.value.trim() !== '' &&
    previewResult.value !== null &&
    previewResult.value.files.length > 0
)

const hasLargeFiles = computed(() => {
  if (previewResult.value === null) return false
  return previewResult.value.files.some((f) => f.variantCountEstimate > LARGE_FILE_THRESHOLD)
})

const largeFilesMessage = computed(() => {
  if (previewResult.value === null) return ''
  const largeFiles = previewResult.value.files.filter(
    (f) => f.variantCountEstimate > LARGE_FILE_THRESHOLD
  )
  if (largeFiles.length === 0) return ''
  if (largeFiles.length === 1) {
    return `Large file detected (~${largeFiles[0].variantCountEstimate.toLocaleString()} variants). Consider adding a BED region filter for faster imports.`
  }
  const totalCount = largeFiles.reduce((sum, f) => sum + f.variantCountEstimate, 0)
  return `${largeFiles.length} large files detected (~${totalCount.toLocaleString()} variants total). Consider adding a BED region filter for faster imports.`
})

const suggestedBedFile = computed(() => {
  if (previewResult.value === null) return null
  if (previewResult.value.siblingBedFiles.length === 0) return null
  return previewResult.value.siblingBedFiles[0]
})

const isBedApplied = computed(
  () => filters.value.bedPath !== undefined && filters.value.bedPath !== ''
)

const pipelineLabel = computed(() => {
  if (previewResult.value === null) return null
  const callers = new Set<string>()
  for (const file of previewResult.value.files) {
    if (file.callerName !== null) callers.add(file.callerName)
  }
  if (callers.size === 0) return null
  if (callers.size === 1) return [...callers][0]
  return `${callers.size} callers`
})

const hasFiltersApplied = computed(
  () =>
    filters.value.passOnly === true ||
    filters.value.minQual !== null ||
    filters.value.minGq !== null ||
    filters.value.minDp !== null ||
    isBedApplied.value
)

const activeFilterCount = computed(() => {
  let count = 0
  if (filters.value.passOnly === true) count++
  if (filters.value.minQual !== null) count++
  if (filters.value.minGq !== null) count++
  if (filters.value.minDp !== null) count++
  if (isBedApplied.value) count++
  return count
})

function handleOverride(filePath: string, override: VariantTypeOverride): void {
  const next = new Map(overrides.value)
  next.set(filePath, { ...next.get(filePath), ...override })
  overrides.value = next
}

function useSuggestedBed(): void {
  if (suggestedBedFile.value === null) return
  filters.value = { ...filters.value, bedPath: suggestedBedFile.value }
}

// ---------------------------------------------------------------------------
// Progress phase
// ---------------------------------------------------------------------------
const fileStatuses = ref(new Map<string, FileStatusEntry>())
const currentFile = ref<string | null>(null)
const overallPercent = ref(0)

let cleanupProgress: (() => void) | null = null
let lastProgressCount = 0

// ---------------------------------------------------------------------------
// Summary phase
// ---------------------------------------------------------------------------
const importResult = ref<MultiFileImportResult | null>(null)

// ---------------------------------------------------------------------------
// Dialog lifecycle
// ---------------------------------------------------------------------------
watch(
  () => props.open,
  (open) => {
    if (open) {
      resetToSelect()
    }
  }
)

onMounted(() => {
  if (api === undefined) return
  cleanupProgress = api.import.onProgress(handleProgressUpdate)
})

onUnmounted(() => {
  cleanupProgress?.()
})

function onDialogUpdate(value: boolean): void {
  if (!value) {
    handleClose()
  }
}

function handleEsc(): void {
  if (phase.value !== 'progress') {
    handleClose()
  }
}

function handleClose(): void {
  if (phase.value === 'progress') return
  emit('update:open', false)
  emit('close')
}

function resetToSelect(): void {
  phase.value = 'select'
  errorMessage.value = null
  isDragging.value = false
  previewLoading.value = false
  pendingFileCount.value = 0
  previewResult.value = null
  caseName.value = ''
  overrides.value = new Map()
  filters.value = {
    passOnly: false,
    minQual: null,
    minGq: null,
    minDp: null,
    bedPath: undefined,
    bedPadding: 50
  }
  fileStatuses.value = new Map()
  currentFile.value = null
  overallPercent.value = 0
  importResult.value = null
  lastProgressCount = 0
}

// ---------------------------------------------------------------------------
// File selection + preview
// ---------------------------------------------------------------------------
async function browseFiles(): Promise<void> {
  if (api === undefined) return
  try {
    const paths = await api.import.selectFiles()
    if (paths.length === 0) return
    await loadPreview(paths)
  } catch (err) {
    handleError('File selection failed', err)
  }
}

async function handleDrop(event: DragEvent): Promise<void> {
  isDragging.value = false
  if (event.dataTransfer === null) return
  const files = Array.from(event.dataTransfer.files)
  if (files.length === 0) return

  // Filter to VCF files only
  const vcfFiles = files.filter((f) => {
    const name = f.name.toLowerCase()
    return name.endsWith('.vcf') || name.endsWith('.vcf.gz')
  })

  if (vcfFiles.length === 0) {
    errorMessage.value = 'Please drop .vcf or .vcf.gz files only.'
    return
  }

  // Electron exposes full paths on dropped File objects
  const paths = vcfFiles
    .map((f) => (f as unknown as { path?: string }).path ?? '')
    .filter((p) => p !== '')

  if (paths.length === 0) {
    errorMessage.value =
      'Could not resolve file paths from dropped files. Use the Browse button instead.'
    return
  }

  await loadPreview(paths)
}

async function loadPreview(filePaths: string[]): Promise<void> {
  if (api === undefined) return
  errorMessage.value = null
  previewLoading.value = true
  pendingFileCount.value = filePaths.length

  try {
    const result = await api.import.vcfMultiPreview(filePaths)
    if (isIpcError(result)) {
      throw new Error(result.userMessage ?? 'Failed to preview VCF files')
    }

    previewResult.value = result
    caseName.value = result.suggestedCaseName

    // Auto-detect BED suggestion when only one sibling BED exists and warrants use
    // (No automatic selection — only show as suggestion to user.)

    phase.value = 'review'
  } catch (err) {
    handleError('VCF preview failed', err)
  } finally {
    previewLoading.value = false
    pendingFileCount.value = 0
  }
}

// ---------------------------------------------------------------------------
// Import execution
// ---------------------------------------------------------------------------
async function startImport(): Promise<void> {
  if (api === undefined || previewResult.value === null) return
  if (!canImport.value) return

  // Build specs from preview + overrides
  const specs: MultiFileImportSpec[] = previewResult.value.files.map((file) => {
    const override = overrides.value.get(file.filePath)
    const variantType = override?.variantType ?? file.defaultVariantType
    const annotationFormat = file.annotationType === 'none' ? null : file.annotationType
    return {
      filePath: file.filePath,
      variantType,
      caller: file.callerName,
      annotationFormat
    }
  })

  // Initialize per-file statuses
  const statuses = new Map<string, FileStatusEntry>()
  for (const file of previewResult.value.files) {
    statuses.set(file.filePath, { status: 'pending' })
  }
  fileStatuses.value = statuses
  currentFile.value = specs[0].filePath
  overallPercent.value = 0
  lastProgressCount = 0

  // Mark first file as importing
  markFileStatus(specs[0].filePath, { status: 'importing', phase: 'reading', liveCount: 0 })

  phase.value = 'progress'

  try {
    // Note: backend currently ignores filters via startMultiFile — see ImportFilterOptions.vue TODO
    const result = await api.import.startMultiFile(
      caseName.value.trim(),
      specs,
      previewResult.value.files[0].detectedGenomeBuild !== null &&
        previewResult.value.files[0].detectedGenomeBuild !== ''
        ? { genomeBuild: previewResult.value.files[0].detectedGenomeBuild }
        : undefined
    )

    if (isIpcError(result)) {
      throw new Error(result.userMessage ?? 'Multi-file import failed')
    }

    // Reconcile final per-file statuses with server results
    const serverResult = result as MultiFileImportResult
    for (const fileRes of serverResult.files) {
      if (fileRes.error !== undefined) {
        markFileStatus(fileRes.filePath, {
          status: 'error',
          error: fileRes.error,
          variantCount: fileRes.variantCount
        })
      } else {
        markFileStatus(fileRes.filePath, {
          status: 'done',
          variantCount: fileRes.variantCount
        })
      }
    }

    currentFile.value = null
    overallPercent.value = 100
    importResult.value = serverResult
    phase.value = 'summary'

    emit('case-imported', {
      caseId: serverResult.caseId,
      caseName: caseName.value.trim(),
      variantCount: serverResult.totalVariants
    })
  } catch (err) {
    logService.error(
      `Multi-file VCF import failed: ${err instanceof Error ? err.message : String(err)}`,
      'VcfImportDialog'
    )
    // Mark current file as errored
    if (currentFile.value !== null) {
      markFileStatus(currentFile.value, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err)
      })
    }
    errorMessage.value = err instanceof Error ? err.message : String(err)
    // Return to review so the user can retry or adjust
    phase.value = 'review'
  }
}

/**
 * Progress events from the backend do not carry a file path. Because
 * startMultiFileImport processes files strictly in order, we advance
 * `currentFile` whenever the progress count resets (new file begins with
 * phase=reading, count=0).
 */
function handleProgressUpdate(update: ProgressUpdate): void {
  if (phase.value !== 'progress' || previewResult.value === null) return

  const filesList = previewResult.value.files
  const current = currentFile.value
  if (current === null) return

  // Detect transition to next file: count dropped back near zero in reading phase
  if (update.phase === 'reading' && update.count < lastProgressCount) {
    // Previous file finished — mark as done (variantCount will be reconciled at end)
    markFileStatus(current, { status: 'done', variantCount: lastProgressCount })
    const idx = filesList.findIndex((f) => f.filePath === current)
    if (idx >= 0 && idx < filesList.length - 1) {
      const nextPath = filesList[idx + 1].filePath
      currentFile.value = nextPath
      markFileStatus(nextPath, {
        status: 'importing',
        phase: update.phase,
        liveCount: update.count
      })
    }
  } else {
    // Update current file progress
    markFileStatus(current, {
      status: 'importing',
      phase: update.phase,
      liveCount: update.count
    })
  }

  lastProgressCount = update.count

  // Update overall percent heuristically: weight each file equally by count
  const doneCount = Array.from(fileStatuses.value.values()).filter(
    (s) => s.status === 'done' || s.status === 'error'
  ).length
  const totalFiles = filesList.length
  // Base progress: completed files contribute full share; current file contributes partial
  const basePercent = (doneCount / totalFiles) * 100
  // Assume current file is ~halfway through as a visual cue; cap at 95% until completion
  const currentFilePercent =
    update.phase === 'inserting' ? 0.8 : update.phase === 'parsing' ? 0.5 : 0.2
  const addedPercent = (currentFilePercent / totalFiles) * 100
  overallPercent.value = Math.min(95, Math.round(basePercent + addedPercent))
}

function markFileStatus(filePath: string, entry: Partial<FileStatusEntry>): void {
  const next = new Map(fileStatuses.value)
  const existing = next.get(filePath) ?? { status: 'pending' }
  next.set(filePath, { ...existing, ...entry } as FileStatusEntry)
  fileStatuses.value = next
}

// ---------------------------------------------------------------------------
// Summary actions
// ---------------------------------------------------------------------------
function handleViewCase(): void {
  if (importResult.value === null) return
  selectedCaseId.value = importResult.value.caseId
  selectedCaseName.value = caseName.value.trim()
  selectedVariantCount.value = importResult.value.totalVariants
  selectedCreatedAt.value = Date.now()
  activeTab.value = 'case'
  void router.push('/case')
  handleClose()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  return idx === -1 ? normalized : normalized.slice(idx + 1)
}

function handleError(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  errorMessage.value = `${context}: ${message}`
  logService.error(`${context}: ${message}`, 'VcfImportDialog')
}
</script>

<style scoped>
.vcf-import-dialog {
  background-color: rgb(var(--v-theme-background));
}

.drop-zone {
  border: 2px dashed rgba(var(--v-theme-primary), 0.4);
  background-color: rgba(var(--v-theme-primary), 0.02);
  transition: all 0.15s ease;
}

.drop-zone--active {
  border-color: rgb(var(--v-theme-primary));
  background-color: rgba(var(--v-theme-primary), 0.08);
  transform: scale(1.01);
}

.drop-zone--loading {
  border-style: solid;
  border-color: rgb(var(--v-theme-primary));
}
</style>
