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
        v-if="cancelError || (importStore.phase === 'error' && importStore.errorMessage)"
        type="error"
        variant="tonal"
        closable
        class="mx-4 mt-3"
        @click:close="cancelError ? (cancelError = '') : importStore.reset()"
      >
        {{ cancelError || importStore.errorMessage }}
      </v-alert>

      <!-- Step 1: Source Selection -->
      <v-card-text v-if="step === 1" class="pa-4">
        <ImportSourceSelector
          :sources="allSources"
          :pending="sourceSelectionPending"
          :upload-file-name="uploadFileName"
          :upload-file-index="uploadFileIndex"
          :upload-total-files="uploadTotalFiles"
          :upload-percent="uploadPercent"
          :upload-loaded-bytes="importStore.uploadLoadedBytes"
          :upload-total-bytes="importStore.uploadTotalBytes"
          @select="selectSource"
          @cancel="cancelUploadSelection"
        />

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
  BatchProgress,
  ProgressUpdate
} from '../../../../shared/types/api'
import type { VcfPreviewResult } from '../../../../shared/types/vcf'
import { useApiService } from '../../composables/useApiService'
import { useImportStatusStore } from '../../stores/importStatusStore'
import { logService } from '../../services/LogService'
import { unwrapIpcResult } from '../../../../shared/types/errors'
import { formatErrorMessage } from '../../../../shared/errors/format-error-message'
import BatchReviewPhase from '../batch-import/BatchReviewPhase.vue'
import BatchProgressPhase from '../batch-import/BatchProgressPhase.vue'
import BatchSummaryPhase from '../batch-import/BatchSummaryPhase.vue'
import ImportSourceSelector from './ImportSourceSelector.vue'
import type { ImportSourceMode, ImportSourceOption } from './ImportSourceSelector.vue'
import VcfPreviewStep from './VcfPreviewStep.vue'
import { isWebRuntime } from '../../utils/runtime-mode'
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

type ImportMode = ImportSourceMode

const { api } = useApiService()
const importStore = useImportStatusStore()

const WEB_UPLOAD_EVENT = 'varlens:web-upload'
const WEB_UPLOAD_CANCEL_EVENT = 'varlens:web-upload-cancel'

interface WebUploadEventDetail {
  status: 'started' | 'progress' | 'complete' | 'error' | 'aborted'
  fileName: string
  fileIndex: number
  totalFiles: number
  loadedBytes: number
  totalBytes: number | null
  percent: number | null
  message?: string
}

const emit = defineEmits<{
  'import-complete': [result: { caseId: number; variantCount: number; caseName: string }]
  'batch-import-complete': [result: { totalImported: number }]
}>()

const dialog = ref(false)
const step = ref(1)
const cancelError = ref('')

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

const allSources: ImportSourceOption[] = [
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
const sourceSelectionPending = ref(false)
const uploadFileName = ref('')
const uploadFileIndex = ref(1)
const uploadTotalFiles = ref(0)
const uploadPercent = ref<number | null>(null)

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
let cleanupImportProgress: (() => void) | null = null
let cleanupComplete: (() => void) | null = null
let importRunGeneration = 0
let activeBatchRunGeneration: number | null = null
let cancellationRequestedGeneration: number | null = null
let recheckTimeout: ReturnType<typeof setTimeout> | null = null

function resetUploadState(): void {
  uploadFileName.value = ''
  uploadFileIndex.value = 1
  uploadTotalFiles.value = 0
  uploadPercent.value = null
}

function handleWebUploadEvent(event: Event): void {
  if (!isWebRuntime()) return
  const detail = (event as CustomEvent<WebUploadEventDetail>).detail
  uploadFileName.value = detail.fileName
  uploadFileIndex.value = detail.fileIndex + 1
  uploadTotalFiles.value = detail.totalFiles
  uploadPercent.value = detail.percent

  if (detail.status === 'started') {
    importStore.startUpload(detail.totalFiles)
  }
  if (detail.status === 'started' || detail.status === 'progress' || detail.status === 'complete') {
    importStore.updateUploadProgress({
      fileIndex: detail.fileIndex,
      totalFiles: detail.totalFiles,
      fileName: detail.fileName,
      loadedBytes: detail.loadedBytes,
      totalBytes: detail.totalBytes,
      percent: detail.percent
    })
  }
  if (detail.status === 'aborted') {
    importStore.importComplete({
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: true,
      details: []
    })
  }
  if (detail.status === 'error') {
    importStore.importError(detail.message ?? 'Upload failed')
  }
}

function cancelUploadSelection(): void {
  if (isWebRuntime()) {
    window.dispatchEvent(new CustomEvent(WEB_UPLOAD_CANCEL_EVENT))
  }
}

function formatIpcError(error: unknown, fallback: string): string {
  return formatErrorMessage(error, fallback)
}

function cleanupZipTempInBackground(context: string): void {
  void api!.batchImport
    .cleanupZipTemp()
    .then((cleanupResult) => {
      unwrapIpcResult(cleanupResult)
    })
    .catch((error) => {
      logService.warn(
        `ZIP temp cleanup failed after ${context}: ${formatIpcError(error, 'cleanup failed')}`,
        'ImportWizard'
      )
    })
}

// Re-check duplicates when strip text changes
watch(stripText, () => {
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
  recheckTimeout = setTimeout(async () => {
    if (selectedFilePaths.value.length === 0) return
    const result = unwrapIpcResult(
      await api!.batchImport.checkDuplicates(
        [...selectedFilePaths.value],
        stripText.value || undefined
      )
    )
    reviewFiles.value = result.files
    duplicateCount.value = result.duplicateCount
  }, 300)
})

async function selectSource(mode: ImportMode): Promise<void> {
  if (sourceSelectionPending.value) return
  selectedMode.value = mode
  sourceSelectionPending.value = true
  resetUploadState()

  try {
    if (mode === 'zip') {
      const result = unwrapIpcResult(await api!.batchImport.selectZip())
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
      const path = unwrapIpcResult(await api!.import.selectFile())
      if (path === null) return
      filePaths = [path]
    } else if (mode === 'files') {
      filePaths = unwrapIpcResult(await api!.batchImport.selectFiles())
    } else {
      filePaths = unwrapIpcResult(await api!.batchImport.selectFolder())
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
    if (err instanceof Error && err.message === 'Upload cancelled') {
      resetUploadState()
      return
    }
    const message = formatIpcError(err, 'File selection failed')
    logService.error(`File selection failed: ${message}`, 'ImportWizard')
    importStore.importError(message)
  } finally {
    sourceSelectionPending.value = false
    if (importStore.phase === 'uploading') {
      importStore.reset()
    }
  }
}

async function extractAndAdvance(path: string): Promise<void> {
  const { files } = unwrapIpcResult(
    await api!.batchImport.extractZip(path, zipPassword.value || undefined)
  )
  if (files.length === 0) return

  selectedFilePaths.value = files
  zipPasswordNeeded.value = false
  await checkDuplicatesAndAdvance(files)
}

async function checkDuplicatesAndAdvance(filePaths: string[]): Promise<void> {
  const result = unwrapIpcResult(
    await api!.batchImport.checkDuplicates(filePaths, stripText.value || undefined)
  )

  reviewFiles.value = result.files
  duplicateCount.value = result.duplicateCount
  step.value = 2
}

async function unlockZip(): Promise<void> {
  zipUnlocking.value = true
  zipError.value = ''
  const { success } = unwrapIpcResult(
    await api!.batchImport.testZipPassword(zipPath.value, zipPassword.value)
  )
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

function beginImportRun(kind: 'vcf' | 'batch'): number {
  importRunGeneration += 1
  activeBatchRunGeneration = kind === 'batch' ? importRunGeneration : null
  cancellationRequestedGeneration = null
  return importRunGeneration
}

function isImportTerminal(generation: number): boolean {
  return generation !== importRunGeneration || step.value !== 3 || importStore.phase === 'cancelled'
}

function completeCancelledRun(generation: number): void {
  if (isImportTerminal(generation)) return
  importRunGeneration += 1
  activeBatchRunGeneration = null
  cancellationRequestedGeneration = null
  const cancelledResult: BatchResult = {
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: true,
    details: []
  }
  summary.value = cancelledResult
  step.value = 4
  importStore.importComplete({ ...cancelledResult, details: [] })
}

async function startVcfImport(): Promise<void> {
  if (importStore.isActive) {
    logService.warn('Import already in progress — cannot start another', 'ImportWizard')
    return
  }

  const generation = beginImportRun('vcf')

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
      if (cancellationRequestedGeneration === generation) {
        completeCancelledRun(generation)
        return
      }
      if (isImportTerminal(generation)) break

      const sample = vcfSelectedSamples.value[i]
      const caseName = vcfCaseNames.value.get(sample) ?? sample

      currentIndex.value = i
      currentFileName.value = caseName
      overallPercent.value = Math.round(((i + 1) / vcfSelectedSamples.value.length) * 100)

      try {
        const result = unwrapIpcResult(
          await api!.import.start(vcfFilePath.value, caseName, {
            selectedSample: sample,
            genomeBuild: vcfGenomeBuild.value ?? undefined
          })
        )

        if (cancellationRequestedGeneration === generation) {
          completeCancelledRun(generation)
          return
        }
        if (isImportTerminal(generation)) break

        results.succeeded++
        results.details.push({
          filePath: vcfFilePath.value,
          fileName: caseName,
          caseName,
          status: 'success' as const,
          variantCount: (result as { variantCount: number }).variantCount
        })
      } catch (err) {
        if (cancellationRequestedGeneration === generation) {
          completeCancelledRun(generation)
          return
        }
        if (isImportTerminal(generation)) break
        results.failed++
        results.details.push({
          filePath: vcfFilePath.value,
          fileName: caseName,
          caseName,
          status: 'failed' as const,
          error: formatIpcError(err, 'VCF import failed')
        })
      }
    }

    if (cancellationRequestedGeneration === generation) {
      completeCancelledRun(generation)
      return
    }
    if (isImportTerminal(generation)) return

    cancelError.value = ''
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
    if (cancellationRequestedGeneration === generation) {
      completeCancelledRun(generation)
      return
    }
    if (isImportTerminal(generation)) return
    const message = formatIpcError(err, 'VCF import failed')
    logService.error(`VCF import failed: ${message}`, 'ImportWizard')
    cancelError.value = ''
    summary.value = {
      succeeded: 0,
      failed: vcfSelectedSamples.value.length,
      skipped: 0,
      cancelled: false,
      details: []
    }
    step.value = 4
    importStore.importError(message)
  }
}

async function startImport(): Promise<void> {
  // Prevent starting a new import while one is already running.
  // This avoids resetting the store state and losing progress on the active import.
  if (importStore.isActive) {
    logService.warn('Import already in progress — cannot start another', 'ImportWizard')
    return
  }

  const generation = beginImportRun('batch')

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
    const result = unwrapIpcResult(
      await api!.batchImport.start(
        [...selectedFilePaths.value],
        duplicateStrategy.value,
        stripText.value || undefined
      )
    )

    // Result also arrives via onComplete callback; guard against double-processing
    if (!isImportTerminal(generation) && activeBatchRunGeneration === generation) {
      activeBatchRunGeneration = null
      cancellationRequestedGeneration = null
      cancelError.value = ''
      summary.value = result
      step.value = 4

      importStore.importComplete({
        ...result,
        details: result.details.map((d) => ({ ...d, caseName: d.caseName ?? d.fileName }))
      })

      if (isZipImport.value) {
        cleanupZipTempInBackground('import completion')
      }

      if (result.succeeded > 0) {
        emit('batch-import-complete', { totalImported: result.succeeded })
      }
    }
  } catch (err) {
    // Only overwrite summary if the onComplete callback hasn't already
    // handled it (race: safeEmit fires before resolve, so the event
    // listener may have already set the correct summary + step 4).
    if (!isImportTerminal(generation) && activeBatchRunGeneration === generation) {
      activeBatchRunGeneration = null
      if (cancellationRequestedGeneration === generation) {
        completeCancelledRun(generation)
        return
      }
      cancellationRequestedGeneration = null
      const message = formatIpcError(err, 'Import failed')
      logService.error(`Import failed: ${message}`, 'ImportWizard')
      cancelError.value = ''
      summary.value = {
        succeeded: 0,
        failed: fileCount.value,
        skipped: 0,
        cancelled: false,
        details: []
      }
      step.value = 4
      importStore.importError(message)
    }
  }
}

async function cancelImport(): Promise<void> {
  const generation = importRunGeneration
  cancelError.value = ''
  try {
    const result = isVcfImport.value ? await api!.import.cancel() : await api!.batchImport.cancel()
    unwrapIpcResult(result)
  } catch (error) {
    if (isImportTerminal(generation)) return
    cancelError.value = formatIpcError(error, 'Cancellation failed')
    logService.warn(`Import cancel failed: ${cancelError.value}`, 'ImportWizard')
    return
  }
  if (isImportTerminal(generation)) return
  cancellationRequestedGeneration = generation
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
  cancelError.value = ''
  selectedMode.value = null
  selectedFilePaths.value = []
  isVcfImport.value = false
  vcfFilePath.value = ''
  vcfSelectedSamples.value = []
  vcfGenomeBuild.value = 'GRCh38'
  vcfCaseNames.value = new Map()
  isZipImport.value = false
  zipPath.value = ''
  sourceSelectionPending.value = false
  resetUploadState()
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
  if (importStore.isActive) {
    importStore.dialogOpen = true
    dialog.value = true
    return
  }
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
  if (isWebRuntime()) {
    window.addEventListener(WEB_UPLOAD_EVENT, handleWebUploadEvent)
  }
  if (api) {
    if (isWebRuntime()) {
      cleanupImportProgress = api.import.onProgress((progress: ProgressUpdate) => {
        if (!isVcfImport.value || !importStore.isActive || activeBatchRunGeneration !== null) return
        variantCount.value = progress.count
        const sampleCount = Math.max(vcfSelectedSamples.value.length, 1)
        overallPercent.value = Math.max(
          overallPercent.value,
          Math.round(((currentIndex.value + 1) / sampleCount) * 100)
        )
        importStore.updateProgress({
          fileIndex: currentIndex.value,
          totalFiles: totalFiles.value,
          fileName: currentFileName.value,
          overallPercent: overallPercent.value,
          phase: progress.phase,
          skipped: progress.skipped ?? 0,
          variantCount: progress.count
        })
      })
    }

    cleanupProgress = api.batchImport.onProgress((progress: BatchProgress) => {
      const generation = activeBatchRunGeneration
      if (generation === null || isImportTerminal(generation)) return
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
      const generation = activeBatchRunGeneration
      // Guard: startImport() await may have already handled this
      if (generation !== null && !isImportTerminal(generation)) {
        activeBatchRunGeneration = null
        cancellationRequestedGeneration = null
        cancelError.value = ''
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
          cleanupZipTempInBackground('dialog close')
        }
      }
    })
  }
})

onUnmounted(() => {
  if (isWebRuntime()) {
    window.removeEventListener(WEB_UPLOAD_EVENT, handleWebUploadEvent)
  }
  cleanupProgress?.()
  cleanupImportProgress?.()
  cleanupComplete?.()
  if (recheckTimeout !== null) clearTimeout(recheckTimeout)
})

defineExpose({ show, reopen })
</script>
