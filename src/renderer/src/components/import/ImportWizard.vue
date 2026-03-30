<template>
  <v-dialog
    v-model="dialog"
    max-width="700"
    :persistent="step === 3"
    scrollable
    transition="dialog-bottom-transition"
  >
    <v-card>
      <!-- Header with step indicator -->
      <v-card-title class="d-flex align-center">
        <v-icon :icon="mdiDatabaseImport" class="mr-2" />
        Import Data
        <v-spacer />
        <v-btn v-if="step !== 3" icon variant="text" size="small" @click="handleClose">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>

      <!-- Step indicator -->
      <div v-if="step > 1" class="d-flex align-center px-4 pb-2 ga-1">
        <template v-for="(s, i) in stepLabels" :key="i">
          <v-chip
            :color="i + 1 <= step ? 'primary' : undefined"
            :variant="i + 1 === step ? 'flat' : i + 1 < step ? 'tonal' : 'outlined'"
            size="x-small"
            label
          >
            {{ i + 1 }}. {{ s }}
          </v-chip>
          <v-icon v-if="i < stepLabels.length - 1" size="x-small" :icon="mdiChevronRight" />
        </template>
      </div>

      <v-divider />

      <!-- Error display -->
      <v-alert
        v-if="importStore.phase === 'error' && importStore.errorMessage"
        type="error"
        variant="tonal"
        closable
        class="mx-4 mt-3"
        @click:close="importStore.reset()"
      >
        {{ importStore.errorMessage }}
      </v-alert>

      <!-- Step 1: Source Selection -->
      <v-card-text v-if="step === 1" class="pa-4">
        <div class="text-caption text-medium-emphasis mb-3">Choose import source</div>
        <div class="d-flex flex-wrap ga-3">
          <v-card
            v-for="src in sources"
            :key="src.mode"
            variant="outlined"
            class="import-source-card flex-grow-1"
            min-width="130"
            @click="selectSource(src.mode)"
          >
            <v-card-text class="d-flex flex-column align-center text-center pa-3">
              <v-icon :icon="src.icon" size="24" color="primary" class="mb-1" />
              <div class="text-body-2 font-weight-medium">{{ src.title }}</div>
              <div class="text-caption text-medium-emphasis">{{ src.subtitle }}</div>
            </v-card-text>
          </v-card>
        </div>

        <!-- ZIP password (inline, shown when needed) -->
        <v-expand-transition>
          <div v-if="zipPasswordNeeded" class="mt-4">
            <v-divider class="mb-3" />
            <div class="text-body-2 font-weight-medium mb-2">ZIP is password-protected</div>
            <v-text-field
              v-model="zipPassword"
              label="Password"
              :type="showZipPassword ? 'text' : 'password'"
              variant="outlined"
              density="compact"
              :error-messages="zipError"
              :append-inner-icon="showZipPassword ? mdiEyeOff : mdiEye"
              @click:append-inner="showZipPassword = !showZipPassword"
              @keydown.enter="unlockZip"
            />
            <div class="d-flex ga-2">
              <v-btn size="small" variant="text" @click="cancelZip">Cancel</v-btn>
              <v-btn
                size="small"
                color="primary"
                variant="flat"
                :loading="zipUnlocking"
                @click="unlockZip"
              >
                Unlock
              </v-btn>
            </div>
          </div>
        </v-expand-transition>
      </v-card-text>

      <!-- Step 2 (VCF only): VCF Preview -->
      <v-card-text v-else-if="isVcfImport && step === 2">
        <VcfPreviewStep
          :file-path="vcfFilePath"
          @preview-loaded="onVcfPreviewLoaded"
          @selection-changed="onVcfSelectionChanged"
        />
      </v-card-text>

      <!-- Step 2 (non-VCF): Review -->
      <v-card-text v-else-if="step === 2">
        <BatchReviewPhase
          v-model:strip-text="stripText"
          v-model:duplicate-strategy="duplicateStrategy"
          :review-files="reviewFiles"
          :file-count="fileCount"
          :duplicate-count="duplicateCount"
          :has-empty-case-names="hasEmptyCaseNames"
        />
      </v-card-text>

      <!-- Step 3: Progress -->
      <v-card-text v-else-if="step === 3">
        <BatchProgressPhase
          :current-file-name="currentFileName"
          :current-index="currentIndex"
          :total-files="totalFiles"
          :overall-percent="overallPercent"
          :variant-count="variantCount"
        />
      </v-card-text>

      <!-- Step 4: Summary -->
      <v-card-text v-else-if="step === 4">
        <BatchSummaryPhase :summary="summary" />
      </v-card-text>

      <v-divider />

      <!-- Actions -->
      <v-card-actions>
        <v-btn v-if="step === 2" variant="text" size="small" @click="step = 1">Back</v-btn>
        <v-spacer />
        <v-btn v-if="step === 3" variant="text" size="small" @click="continueInBackground">
          Continue in Background
        </v-btn>
        <v-btn v-if="step === 3" variant="text" size="small" @click="cancelImport">Cancel</v-btn>

        <!-- VCF import button -->
        <v-btn
          v-if="isVcfImport && step === 2"
          color="primary"
          variant="flat"
          size="small"
          :disabled="vcfSelectedSamples.length === 0 || importStore.isActive"
          @click="startVcfImport"
        >
          {{
            importStore.isActive
              ? 'Import in progress...'
              : `Import ${vcfSelectedSamples.length} ${vcfSelectedSamples.length === 1 ? 'sample' : 'samples'}`
          }}
        </v-btn>

        <!-- Non-VCF import button -->
        <v-btn
          v-if="!isVcfImport && step === 2"
          color="primary"
          variant="flat"
          size="small"
          :disabled="hasEmptyCaseNames || fileCount === 0 || importStore.isActive"
          @click="startImport"
        >
          {{
            importStore.isActive
              ? 'Import in progress...'
              : `Import ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`
          }}
        </v-btn>
        <v-btn v-if="step === 4" color="primary" variant="flat" size="small" @click="handleClose">
          Done
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type {
  DuplicateChoice,
  DuplicateCheckItem,
  BatchResult,
  BatchProgress
} from '../../../../shared/types/api'
import type { VcfPreviewResult } from '../../../../main/import/vcf/types'
import { useApiService } from '../../composables/useApiService'
import { useImportStatusStore } from '../../stores/importStatusStore'
import { logService } from '../../services/LogService'
import BatchReviewPhase from '../batch-import/BatchReviewPhase.vue'
import BatchProgressPhase from '../batch-import/BatchProgressPhase.vue'
import BatchSummaryPhase from '../batch-import/BatchSummaryPhase.vue'
import VcfPreviewStep from './VcfPreviewStep.vue'
import {
  mdiChevronRight,
  mdiClose,
  mdiDatabaseImport,
  mdiEye,
  mdiEyeOff,
  mdiFileDocument,
  mdiFileMultiple,
  mdiFolderOpen,
  mdiZipBox
} from '@mdi/js'

type ImportMode = 'single' | 'files' | 'folder' | 'zip'

const { api } = useApiService()
const importStore = useImportStatusStore()

const emit = defineEmits<{
  'import-complete': [result: { caseId: number; variantCount: number; caseName: string }]
  'batch-import-complete': [result: { totalImported: number }]
}>()

const dialog = ref(false)
const step = ref(1)

// VCF import state
const isVcfImport = ref(false)
const vcfFilePath = ref('')
const vcfSelectedSamples = ref<string[]>([])
const vcfGenomeBuild = ref('GRCh38')
const vcfCaseNames = ref(new Map<string, string>())

const stepLabels = computed(() => {
  if (isVcfImport.value) {
    return ['Source', 'VCF Preview', 'Import', 'Summary']
  }
  return ['Source', 'Review', 'Import', 'Summary']
})

const sources = [
  {
    mode: 'single' as ImportMode,
    icon: mdiFileDocument,
    title: 'Single File',
    subtitle: 'JSON / VCF'
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
  { mode: 'zip' as ImportMode, icon: mdiZipBox, title: 'ZIP Archive', subtitle: 'Extract & import' }
]

// File selection state
const selectedMode = ref<ImportMode | null>(null)
const selectedFilePaths = ref<string[]>([])
const isZipImport = ref(false)
const zipPath = ref('')

// ZIP password state
const zipPasswordNeeded = ref(false)
const zipPassword = ref('')
const showZipPassword = ref(false)
const zipError = ref('')
const zipUnlocking = ref(false)

// Review state
const reviewFiles = ref<DuplicateCheckItem[]>([])
const duplicateCount = ref(0)
const fileCount = computed(() => reviewFiles.value.length)
const duplicateStrategy = ref<DuplicateChoice>('skip')
const stripText = ref('')
const hasEmptyCaseNames = computed(() => reviewFiles.value.some((f) => f.caseName.trim() === ''))

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

let cleanupProgress: (() => void) | null = null
let cleanupComplete: (() => void) | null = null
let recheckTimeout: ReturnType<typeof setTimeout> | null = null

// Re-check duplicates when strip text changes
watch(stripText, () => {
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
  recheckTimeout = setTimeout(async () => {
    if (selectedFilePaths.value.length === 0) return
    const result = await api!.batchImport.checkDuplicates(
      [...selectedFilePaths.value],
      stripText.value || undefined
    )
    reviewFiles.value = result.files
    duplicateCount.value = result.duplicateCount
  }, 300)
})

async function selectSource(mode: ImportMode): Promise<void> {
  selectedMode.value = mode

  try {
    if (mode === 'zip') {
      const result = await api!.batchImport.selectZip()
      if (result === null) return

      zipPath.value = result.filePath
      isZipImport.value = true

      if (result.isEncrypted) {
        zipPasswordNeeded.value = true
        return
      }

      await extractAndAdvance(result.filePath)
      return
    }

    let filePaths: string[]

    if (mode === 'single') {
      const path = await api!.import.selectFile()
      if (path === null) return
      filePaths = [path]
    } else if (mode === 'files') {
      filePaths = await api!.batchImport.selectFiles()
    } else {
      filePaths = await api!.batchImport.selectFolder()
    }

    if (filePaths.length === 0) return

    selectedFilePaths.value = filePaths

    // Detect VCF file: single file with .vcf or .vcf.gz extension
    if (filePaths.length === 1) {
      const fp = filePaths[0].toLowerCase()
      if (fp.endsWith('.vcf') || fp.endsWith('.vcf.gz')) {
        isVcfImport.value = true
        vcfFilePath.value = filePaths[0]
        step.value = 2 // Go to VCF Preview step
        return
      }
    }

    await checkDuplicatesAndAdvance(filePaths)
  } catch (err) {
    logService.error(
      `File selection failed: ${err instanceof Error ? err.message : String(err)}`,
      'ImportWizard'
    )
    importStore.importError(err instanceof Error ? err.message : 'File selection failed')
  }
}

async function extractAndAdvance(path: string): Promise<void> {
  const { files } = await api!.batchImport.extractZip(path, zipPassword.value || undefined)
  if (files.length === 0) return

  selectedFilePaths.value = files
  zipPasswordNeeded.value = false
  await checkDuplicatesAndAdvance(files)
}

async function checkDuplicatesAndAdvance(filePaths: string[]): Promise<void> {
  const result = await api!.batchImport.checkDuplicates(filePaths, stripText.value || undefined)

  // Guard against error responses from wrapHandler (returns SerializableError on failure)
  if (!Array.isArray((result as unknown as Record<string, unknown>).files)) {
    logService.error('checkDuplicates returned invalid result', 'ImportWizard')
    importStore.importError('Failed to check files. Please try again.')
    return
  }

  reviewFiles.value = result.files
  duplicateCount.value = result.duplicateCount
  step.value = 2
}

async function unlockZip(): Promise<void> {
  zipUnlocking.value = true
  zipError.value = ''
  const { success } = await api!.batchImport.testZipPassword(zipPath.value, zipPassword.value)
  zipUnlocking.value = false

  if (!success) {
    zipError.value = 'Incorrect password'
    return
  }

  await extractAndAdvance(zipPath.value)
}

function cancelZip(): void {
  zipPasswordNeeded.value = false
  zipPassword.value = ''
  zipError.value = ''
}

function onVcfPreviewLoaded(_preview: VcfPreviewResult): void {
  // Preview data is stored in the child component; we just note it loaded
  logService.info('VCF preview loaded successfully', 'ImportWizard')
}

function onVcfSelectionChanged(options: {
  selectedSamples: string[]
  genomeBuild: string
  caseNames: Map<string, string>
}): void {
  vcfSelectedSamples.value = options.selectedSamples
  vcfGenomeBuild.value = options.genomeBuild
  vcfCaseNames.value = options.caseNames
}

async function startVcfImport(): Promise<void> {
  if (importStore.isActive) {
    logService.warn('Import already in progress — cannot start another', 'ImportWizard')
    return
  }

  step.value = 3
  totalFiles.value = vcfSelectedSamples.value.length
  currentIndex.value = 0
  overallPercent.value = 0
  variantCount.value = 0

  importStore.startImport(vcfSelectedSamples.value.length)
  importStore.dialogOpen = true

  const results: BatchResult = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: false,
    details: []
  }

  try {
    for (let i = 0; i < vcfSelectedSamples.value.length; i++) {
      // Check for cancellation between samples
      if (importStore.phase === 'cancelled') break

      const sample = vcfSelectedSamples.value[i]
      const caseName = vcfCaseNames.value.get(sample) ?? sample

      currentIndex.value = i + 1
      currentFileName.value = caseName
      overallPercent.value = Math.round(((i + 1) / vcfSelectedSamples.value.length) * 100)

      try {
        const result = await api!.import.start(vcfFilePath.value, caseName, {
          selectedSample: sample,
          genomeBuild: vcfGenomeBuild.value ?? undefined
        })
        const resultObj = result as unknown as Record<string, unknown>

        if ('userMessage' in resultObj) {
          results.failed++
          results.details.push({
            filePath: vcfFilePath.value,
            fileName: caseName,
            caseName,
            status: 'failed' as const,
            error: String(resultObj.userMessage)
          })
        } else {
          results.succeeded++
          results.details.push({
            filePath: vcfFilePath.value,
            fileName: caseName,
            caseName,
            status: 'success' as const,
            variantCount: (result as { variantCount: number }).variantCount
          })
        }
      } catch (err) {
        results.failed++
        results.details.push({
          filePath: vcfFilePath.value,
          fileName: caseName,
          caseName,
          status: 'failed' as const,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    summary.value = results
    step.value = 4
    importStore.importComplete({
      ...results,
      details: results.details.map((d) => ({ ...d, caseName: d.caseName ?? d.fileName }))
    })

    if (results.succeeded > 0) {
      emit('batch-import-complete', { totalImported: results.succeeded })
    }
  } catch (err) {
    logService.error(
      `VCF import failed: ${err instanceof Error ? err.message : String(err)}`,
      'ImportWizard'
    )
    summary.value = {
      succeeded: 0,
      failed: vcfSelectedSamples.value.length,
      skipped: 0,
      cancelled: false,
      details: []
    }
    step.value = 4
    importStore.importError(err instanceof Error ? err.message : 'VCF import failed')
  }
}

async function startImport(): Promise<void> {
  // Prevent starting a new import while one is already running.
  // This avoids resetting the store state and losing progress on the active import.
  if (importStore.isActive) {
    logService.warn('Import already in progress — cannot start another', 'ImportWizard')
    return
  }

  step.value = 3
  totalFiles.value = fileCount.value
  currentIndex.value = 0
  overallPercent.value = 0
  variantCount.value = 0

  importStore.startImport(fileCount.value)
  importStore.dialogOpen = true

  try {
    // Spread reactive arrays to plain arrays — Vue Proxies cannot be
    // structured-cloned by Electron's IPC serialization.
    const result = await api!.batchImport.start(
      [...selectedFilePaths.value],
      duplicateStrategy.value,
      stripText.value || undefined
    )

    // Guard against error responses from wrapHandler (returns SerializableError on failure)
    if (!Array.isArray((result as unknown as Record<string, unknown>).details)) {
      const errorMsg =
        'userMessage' in (result as unknown as Record<string, unknown>)
          ? (result as unknown as { userMessage: string }).userMessage
          : 'Import failed unexpectedly'
      logService.error(`Import returned error: ${JSON.stringify(result)}`, 'ImportWizard')
      summary.value = {
        succeeded: 0,
        failed: fileCount.value,
        skipped: 0,
        cancelled: false,
        details: []
      }
      step.value = 4
      importStore.importError(errorMsg)
      return
    }

    // Result also arrives via onComplete callback; guard against double-processing
    if (step.value === 3) {
      summary.value = result
      step.value = 4

      importStore.importComplete({
        ...result,
        details: result.details.map((d) => ({ ...d, caseName: d.caseName ?? d.fileName }))
      })

      if (isZipImport.value) {
        api!.batchImport.cleanupZipTemp()
      }

      if (result.succeeded > 0) {
        emit('batch-import-complete', { totalImported: result.succeeded })
      }
    }
  } catch (err) {
    logService.error(
      `Import failed: ${err instanceof Error ? err.message : String(err)}`,
      'ImportWizard'
    )
    // Only overwrite summary if the onComplete callback hasn't already
    // handled it (race: safeEmit fires before resolve, so the event
    // listener may have already set the correct summary + step 4).
    if (step.value === 3) {
      summary.value = {
        succeeded: 0,
        failed: fileCount.value,
        skipped: 0,
        cancelled: false,
        details: []
      }
      step.value = 4
    }
    importStore.importError(err instanceof Error ? err.message : 'Import failed')
  }
}

function cancelImport(): void {
  api!.batchImport.cancel()
  // Transition to summary step showing cancellation, and reset import store.
  // The onComplete callback may also fire with cancelled=true, but we handle
  // it here immediately so the user sees feedback right away.
  summary.value = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: true,
    details: []
  }
  step.value = 4
  importStore.importComplete({
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: true,
    details: []
  })
}

function continueInBackground(): void {
  importStore.dialogOpen = false
  dialog.value = false
}

function handleClose(): void {
  if (step.value === 3) {
    continueInBackground()
    return
  }
  dialog.value = false
  // Reset import store when closing from summary/error step
  if (step.value === 4 || importStore.phase === 'error') {
    importStore.reset()
  }
}

function resetState(): void {
  step.value = 1
  selectedMode.value = null
  selectedFilePaths.value = []
  isVcfImport.value = false
  vcfFilePath.value = ''
  vcfSelectedSamples.value = []
  vcfGenomeBuild.value = 'GRCh38'
  vcfCaseNames.value = new Map()
  isZipImport.value = false
  zipPath.value = ''
  zipPasswordNeeded.value = false
  zipPassword.value = ''
  zipError.value = ''
  showZipPassword.value = false
  zipUnlocking.value = false
  reviewFiles.value = []
  duplicateCount.value = 0
  duplicateStrategy.value = 'skip'
  stripText.value = ''
  currentIndex.value = 0
  totalFiles.value = 0
  currentFileName.value = ''
  overallPercent.value = 0
  variantCount.value = 0
  summary.value = { succeeded: 0, failed: 0, skipped: 0, cancelled: false, details: [] }
}

const show = (): void => {
  resetState()
  dialog.value = true
}

// Reset import store when dialog is closed by any means (outside click, Esc, etc.)
// handleClose() covers explicit close, but the dialog can also close via v-model
// when persistent=false (step !== 3).
watch(dialog, (open) => {
  if (!open && (step.value === 4 || importStore.phase === 'error')) {
    importStore.reset()
  }
})

const reopen = (): void => {
  if (importStore.isActive) {
    importStore.dialogOpen = true
    dialog.value = true
  }
}

onMounted(() => {
  if (api) {
    cleanupProgress = api.batchImport.onProgress((progress: BatchProgress) => {
      currentIndex.value = progress.currentIndex
      totalFiles.value = progress.totalFiles
      currentFileName.value = progress.currentFileName
      overallPercent.value = progress.overallPercent
      variantCount.value = progress.fileProgress?.count ?? 0

      if (importStore.isActive) {
        importStore.updateProgress({
          fileIndex: progress.currentIndex,
          totalFiles: progress.totalFiles,
          fileName: progress.currentFileName,
          overallPercent: progress.overallPercent,
          phase: progress.fileProgress?.phase ?? 'inserting',
          skipped: 0,
          variantCount: progress.fileProgress?.count ?? 0
        })
      }
    })

    cleanupComplete = api.batchImport.onComplete((result: BatchResult) => {
      // Guard: startImport() await may have already handled this
      if (step.value === 3) {
        summary.value = result
        step.value = 4

        importStore.importComplete({
          ...result,
          details: result.details.map((d) => ({
            ...d,
            caseName: d.caseName ?? d.fileName
          }))
        })

        if (isZipImport.value) {
          api!.batchImport.cleanupZipTemp()
        }
      }
    })
  }
})

onUnmounted(() => {
  cleanupProgress?.()
  cleanupComplete?.()
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
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
</style>
