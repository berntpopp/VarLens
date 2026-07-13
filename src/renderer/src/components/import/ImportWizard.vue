<template>
  <v-dialog
    v-model="dialog"
    max-width="700"
    :persistent="step === 3"
    scrollable
    transition="dialog-bottom-transition"
  >
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon :icon="mdiDatabaseImport" class="mr-2" />
        Import Data
        <v-spacer />
        <v-btn v-if="step !== 3" icon variant="text" size="small" @click="handleClose">
          <v-icon :icon="mdiClose" />
        </v-btn>
      </v-card-title>

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

      <v-card-text v-else-if="isVcfImport && step === 2">
        <VcfPreviewStep
          :file-path="vcfFilePath"
          @preview-loaded="onVcfPreviewLoaded"
          @selection-changed="onVcfSelectionChanged"
        />
      </v-card-text>

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

      <v-card-text v-else-if="step === 3">
        <BatchProgressPhase
          :current-file-name="currentFileName"
          :current-index="currentIndex"
          :total-files="totalFiles"
          :overall-percent="overallPercent"
          :variant-count="variantCount"
        />
      </v-card-text>

      <v-card-text v-else-if="step === 4">
        <BatchSummaryPhase :summary="summary" />
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-btn v-if="step === 2" variant="text" size="small" @click="handleBack">Back</v-btn>
        <v-spacer />
        <v-btn v-if="step === 3" variant="text" size="small" @click="continueInBackground">
          Continue in Background
        </v-btn>
        <v-btn v-if="step === 3" variant="text" size="small" @click="cancelImport">Cancel</v-btn>

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
  BatchProgressEvent,
  BatchCompleteEvent,
  ProgressUpdate
} from '../../../../shared/types/api'
import type { VcfPreviewResult } from '../../../../shared/types/vcf'
import { useApiService } from '../../composables/useApiService'
import { useVcfImportExecution } from '../../composables/useVcfImportExecution'
import { useZipImportCleanup } from '../../composables/useZipImportCleanup'
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

const selectedMode = ref<ImportMode | null>(null)
const selectedFilePaths = ref<string[]>([])
const isZipImport = ref(false)
const zipPath = ref('')
const zipExtractionId = ref('')
const sourceSelectionPending = ref(false)
const cancellationPending = ref(false)
const uploadFileName = ref('')
const uploadFileIndex = ref(1)
const uploadTotalFiles = ref(0)
const uploadPercent = ref<number | null>(null)

const zipPasswordNeeded = ref(false)
const zipPassword = ref('')
const showZipPassword = ref(false)
const zipError = ref('')
const zipUnlocking = ref(false)

const reviewFiles = ref<DuplicateCheckItem[]>([])
const duplicateCount = ref(0)
const fileCount = computed(() => reviewFiles.value.length)
const duplicateStrategy = ref<DuplicateChoice>('skip')
const stripText = ref('')
const hasEmptyCaseNames = computed(() => reviewFiles.value.some((f) => f.caseName.trim() === ''))

const currentIndex = ref(0)
const totalFiles = ref(0)
const currentFileName = ref('')
const overallPercent = ref(0)
const variantCount = ref(0)

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
let activeBatchRunId: string | null = null
let cancellationRequestedGeneration: number | null = null
const batchRunExtractionIds = new Map<string, string>()

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

const {
  cleanupZipExtraction,
  abandonZipImport: abandonZipImportState,
  handleBack,
  checkDuplicatesAndAdvance,
  scheduleDuplicateRecheck,
  cancelDuplicateRecheck
} = useZipImportCleanup({
  cleanupRequest: (extractionId) => api!.batchImport.cleanupZipTemp(extractionId),
  checkDuplicatesRequest: (filePaths, strip) => api!.batchImport.checkDuplicates(filePaths, strip),
  importStore,
  state: {
    step,
    selectedFilePaths,
    reviewFiles,
    duplicateCount,
    stripText,
    isZipImport,
    zipPath,
    zipExtractionId,
    zipPasswordNeeded,
    zipPassword,
    zipError,
    showZipPassword,
    zipUnlocking
  }
})

async function cleanupBatchRunExtraction(runId: string, context: string): Promise<void> {
  const extractionId = batchRunExtractionIds.get(runId)
  if (extractionId === undefined) return
  const cleaned = await cleanupZipExtraction(extractionId, context)
  if (!cleaned) return
  batchRunExtractionIds.delete(runId)
  if (zipExtractionId.value === extractionId) zipExtractionId.value = ''
}

let sourceFlowGeneration = 0

function abandonZipImport(context: string): void {
  sourceFlowGeneration += 1
  abandonZipImportState(context)
}
watch(stripText, scheduleDuplicateRecheck)

async function selectSource(mode: ImportMode): Promise<void> {
  if (sourceSelectionPending.value) return
  const generation = sourceFlowGeneration
  selectedMode.value = mode
  sourceSelectionPending.value = true
  resetUploadState()
  try {
    if (mode === 'zip') {
      const result = unwrapIpcResult(await api!.batchImport.selectZip())
      if (generation !== sourceFlowGeneration) return
      if (result === null) return
      zipPath.value = result.filePath
      isZipImport.value = true
      if (result.isEncrypted) {
        zipPasswordNeeded.value = true
        return
      }
      await extractAndAdvance(result.filePath, generation)
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
    if (filePaths.length === 1) {
      const fp = filePaths[0].toLowerCase()
      if (fp.endsWith('.vcf') || fp.endsWith('.vcf.gz')) {
        isVcfImport.value = true
        vcfFilePath.value = filePaths[0]
        step.value = 2
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

async function extractAndAdvance(
  path: string,
  generation: number = sourceFlowGeneration
): Promise<void> {
  const { files, extractionId } = unwrapIpcResult(
    await api!.batchImport.extractZip(path, zipPassword.value || undefined)
  )
  if (generation !== sourceFlowGeneration || !dialog.value) {
    await cleanupZipExtraction(extractionId, 'stale ZIP extraction completion')
    return
  }
  zipExtractionId.value = extractionId
  if (files.length === 0) {
    abandonZipImport('empty ZIP extraction')
    throw new Error('No importable files found in archive')
  }

  selectedFilePaths.value = files
  zipPasswordNeeded.value = false
  await checkDuplicatesAndAdvance(files)
}

async function unlockZip(): Promise<void> {
  const generation = sourceFlowGeneration
  zipUnlocking.value = true
  zipError.value = ''
  try {
    const { success } = unwrapIpcResult(
      await api!.batchImport.testZipPassword(zipPath.value, zipPassword.value)
    )

    if (!success) {
      zipError.value = 'Incorrect password'
      return
    }

    await extractAndAdvance(zipPath.value, generation)
  } catch (err) {
    const message = formatErrorMessage(err, 'Could not unlock ZIP archive')
    zipError.value = message
    logService.error(`ZIP unlock failed: ${message}`, 'ImportWizard')
  } finally {
    zipUnlocking.value = false
  }
}

function cancelZip(): void {
  abandonZipImport('password prompt cancellation')
}

function onVcfPreviewLoaded(_preview: VcfPreviewResult): void {
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
  activeBatchRunId = null
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
  activeBatchRunId = null
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

const { startVcfImport } = useVcfImportExecution({
  api: api!,
  importStore,
  state: {
    filePath: vcfFilePath,
    selectedSamples: vcfSelectedSamples,
    genomeBuild: vcfGenomeBuild,
    caseNames: vcfCaseNames,
    step,
    totalFiles,
    currentIndex,
    overallPercent,
    variantCount,
    currentFileName,
    cancelError,
    summary
  },
  authority: {
    begin: () => beginImportRun('vcf'),
    isTerminal: isImportTerminal,
    isCancellationRequested: (generation) => cancellationRequestedGeneration === generation,
    completeCancelled: completeCancelledRun
  },
  onImported: (totalImported) => emit('batch-import-complete', { totalImported })
})

async function startImport(): Promise<void> {
  if (importStore.isActive) {
    logService.warn('Import already in progress — cannot start another', 'ImportWizard')
    return
  }

  const generation = beginImportRun('batch')
  const runId = globalThis.crypto.randomUUID()
  activeBatchRunId = runId
  if (isZipImport.value && zipExtractionId.value !== '') {
    batchRunExtractionIds.set(runId, zipExtractionId.value)
  }

  step.value = 3
  totalFiles.value = fileCount.value
  currentIndex.value = 0
  overallPercent.value = 0
  variantCount.value = 0

  importStore.startImport(fileCount.value, runId)
  importStore.dialogOpen = true

  try {
    const result = unwrapIpcResult(
      await api!.batchImport.start(
        [...selectedFilePaths.value],
        duplicateStrategy.value,
        stripText.value || undefined,
        runId
      )
    )

    if (
      !isImportTerminal(generation) &&
      activeBatchRunGeneration === generation &&
      activeBatchRunId === runId
    ) {
      activeBatchRunGeneration = null
      activeBatchRunId = null
      cancellationRequestedGeneration = null
      cancelError.value = ''
      summary.value = result
      step.value = 4

      importStore.importComplete({
        ...result,
        details: result.details.map((d) => ({ ...d, caseName: d.caseName ?? d.fileName }))
      })

      void cleanupBatchRunExtraction(runId, 'import completion')

      if (result.succeeded > 0) {
        emit('batch-import-complete', { totalImported: result.succeeded })
      }
    }
  } catch (err) {
    const message = formatIpcError(err, 'Import failed')
    if (
      !isImportTerminal(generation) &&
      activeBatchRunGeneration === generation &&
      activeBatchRunId === runId
    ) {
      activeBatchRunGeneration = null
      activeBatchRunId = null
      if (cancellationRequestedGeneration === generation) {
        completeCancelledRun(generation)
        await cleanupBatchRunExtraction(runId, 'cancelled import termination')
        return
      }
      cancellationRequestedGeneration = null
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
    await cleanupBatchRunExtraction(runId, 'import start failure')
  }
}

async function cancelImport(): Promise<void> {
  const generation = importRunGeneration
  cancelError.value = ''
  if (cancellationPending.value) return
  cancellationPending.value = true
  try {
    const result = isVcfImport.value ? await api!.import.cancel() : await api!.batchImport.cancel()
    unwrapIpcResult(result)
  } catch (error) {
    if (isImportTerminal(generation)) return
    cancelError.value = formatIpcError(error, 'Cancellation failed')
    logService.warn(`Import cancel failed: ${cancelError.value}`, 'ImportWizard')
    return
  } finally {
    cancellationPending.value = false
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
  abandonZipImport('dialog close')
  dialog.value = false
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
  zipExtractionId.value = ''
  sourceSelectionPending.value = false
  resetUploadState()
  zipPasswordNeeded.value = false
  zipPassword.value = ''
  zipError.value = ''
  showZipPassword.value = false
  zipUnlocking.value = false
  cancellationPending.value = false
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
  abandonZipImport('next wizard open')
  resetState()
  dialog.value = true
}

watch(dialog, (open) => {
  if (!open && step.value !== 3) {
    abandonZipImport('dialog dismissal')
  }
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

    cleanupProgress = api.batchImport.onProgress((progress: BatchProgressEvent) => {
      if (progress.runId !== activeBatchRunId) return
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

    cleanupComplete = api.batchImport.onComplete((result: BatchCompleteEvent) => {
      if (result.runId !== activeBatchRunId) return
      const generation = activeBatchRunGeneration
      if (generation !== null && !isImportTerminal(generation)) {
        const { runId, ...batchResult } = result
        activeBatchRunGeneration = null
        activeBatchRunId = null
        cancellationRequestedGeneration = null
        cancelError.value = ''
        summary.value = batchResult
        step.value = 4

        importStore.importComplete({
          ...batchResult,
          details: batchResult.details.map((d) => ({
            ...d,
            caseName: d.caseName ?? d.fileName
          }))
        })

        void cleanupBatchRunExtraction(runId, 'import completion event')
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
  cancelDuplicateRecheck()
  if (step.value !== 3) abandonZipImport('component unmount')
})

defineExpose({ show, reopen })
</script>
