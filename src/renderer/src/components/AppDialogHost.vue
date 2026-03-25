<template>
  <ImportDialog ref="importDialogRef" @import-complete="handleImportComplete" />
  <BatchImportDialog
    ref="batchImportDialogRef"
    @batch-import-complete="handleBatchImportComplete"
  />
  <AppSnackbar ref="snackbarRef" />
  <LogViewer v-model:open="logViewerOpen" />
  <DisclaimerDialog ref="disclaimerRef" @acknowledged="handleDisclaimerAcknowledged" />
  <FaqDialog ref="faqDialogRef" />
  <ExternalLinksSettings ref="externalLinksSettingsRef" />
  <ApplicationPreferences ref="applicationPreferencesRef" />
  <TagManagementDialog ref="tagManagementDialogRef" />
  <DatabaseOverviewDialog ref="databaseOverviewDialogRef" />
  <DeleteAllCasesDialog ref="deleteAllCasesDialogRef" />
  <CaseMetadataModal
    v-if="selectedCaseId"
    ref="caseMetadataModalRef"
    :case-id="selectedCaseId"
    :case-name="selectedCaseName"
    :variant-count="selectedVariantCount"
    :created-at="selectedCreatedAt"
  />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import ImportDialog from './ImportDialog.vue'
import BatchImportDialog from './BatchImportDialog.vue'
import AppSnackbar from './AppSnackbar.vue'
import LogViewer from './LogViewer.vue'
import DisclaimerDialog from './DisclaimerDialog.vue'
import FaqDialog from './FaqDialog.vue'
import ExternalLinksSettings from './ExternalLinksSettings.vue'
import ApplicationPreferences from './ApplicationPreferences.vue'
import TagManagementDialog from './TagManagementDialog.vue'
import DatabaseOverviewDialog from './DatabaseOverviewDialog.vue'
import DeleteAllCasesDialog from './DeleteAllCasesDialog.vue'
import CaseMetadataModal from './CaseMetadataModal.vue'
import { useAppState } from '../composables/useAppState'
import { useVersionGating } from '../composables/useVersionGating'
import { logService } from '../services/LogService'

const {
  selectedCaseId,
  selectedCaseName,
  selectedVariantCount,
  selectedCreatedAt,
  setSnackbarHandler
} = useAppState()

const emit = defineEmits<{
  'import-complete': [result: { caseId: number; variantCount: number; caseName: string }]
  'batch-import-complete': [result: { totalImported: number }]
}>()

// Dialog refs
const importDialogRef = ref<InstanceType<typeof ImportDialog> | null>(null)
const batchImportDialogRef = ref<InstanceType<typeof BatchImportDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)
const disclaimerRef = ref<InstanceType<typeof DisclaimerDialog> | null>(null)
const faqDialogRef = ref<InstanceType<typeof FaqDialog> | null>(null)
const externalLinksSettingsRef = ref<InstanceType<typeof ExternalLinksSettings> | null>(null)
const applicationPreferencesRef = ref<InstanceType<typeof ApplicationPreferences> | null>(null)
const tagManagementDialogRef = ref<InstanceType<typeof TagManagementDialog> | null>(null)
const deleteAllCasesDialogRef = ref<InstanceType<typeof DeleteAllCasesDialog> | null>(null)
const databaseOverviewDialogRef = ref<InstanceType<typeof DatabaseOverviewDialog> | null>(null)
const caseMetadataModalRef = ref<InstanceType<typeof CaseMetadataModal> | null>(null)

// Log viewer state
const logViewerOpen = ref(false)

// Disclaimer acknowledgment state
const disclaimerAcknowledged = ref(false)

// Register snackbar handler for cross-component communication
setSnackbarHandler((message: string, type: string, options?: Record<string, unknown>) => {
  snackbarRef.value?.show(message, type as 'success' | 'error', options)
})

const handleDisclaimerAcknowledged = (): void => {
  disclaimerAcknowledged.value = true
  logService.info('Research disclaimer acknowledged', 'App')
}

const handleImportComplete = (result: {
  caseId: number
  variantCount: number
  caseName: string
}): void => {
  emit('import-complete', result)
  snackbarRef.value?.show(
    `Case imported: ${result.caseName} (${result.variantCount.toLocaleString()} variants)`,
    'success'
  )
}

const handleBatchImportComplete = (result: { totalImported: number }): void => {
  emit('batch-import-complete', result)
  const message =
    result.totalImported === 1
      ? 'Batch import complete: 1 case imported'
      : `Batch import complete: ${result.totalImported} cases imported`
  snackbarRef.value?.show(message, 'success')
}

// Check initial disclaimer acknowledgment state
const { needsAcknowledgment } = useVersionGating()
disclaimerAcknowledged.value = !needsAcknowledgment()

onMounted(() => {
  disclaimerRef.value?.checkAndShow()
})

// Expose dialog triggers for parent coordination
defineExpose({
  showImportDialog: () => importDialogRef.value?.show(),
  showBatchImportDialog: (mode: 'files' | 'folder' | 'zip') =>
    batchImportDialogRef.value?.show(mode),
  showDisclaimer: () => disclaimerRef.value?.show(),
  showFaq: () => faqDialogRef.value?.show(),
  showExternalLinks: () => externalLinksSettingsRef.value?.show(),
  showPreferences: () => applicationPreferencesRef.value?.show(),
  showTagManagement: () => tagManagementDialogRef.value?.show(),
  showDatabaseOverview: () => databaseOverviewDialogRef.value?.show(),
  showDeleteAllCases: (count: number) => deleteAllCasesDialogRef.value?.show(count),
  showCaseMetadata: () => caseMetadataModalRef.value?.show(),
  showSnackbar: (message: string, type: 'success' | 'error') =>
    snackbarRef.value?.show(message, type),
  reopenImportDialog: () => importDialogRef.value?.reopen(),
  reopenBatchImportDialog: () => batchImportDialogRef.value?.reopen(),
  toggleLogViewer: () => {
    logViewerOpen.value = !logViewerOpen.value
  },
  disclaimerAcknowledged
})
</script>
