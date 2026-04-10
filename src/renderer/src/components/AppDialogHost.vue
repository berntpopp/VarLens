<template>
  <ImportWizard
    ref="importWizardRef"
    @import-complete="handleImportComplete"
    @batch-import-complete="handleBatchImportComplete"
  />
  <VcfImportDialog
    v-if="vcfImportMounted"
    v-model:open="vcfImportOpen"
    @case-imported="handleVcfCaseImported"
  />
  <AppSnackbar ref="snackbarRef" />
  <LogViewer v-model:open="logViewerOpen" />
  <DisclaimerDialog ref="disclaimerRef" @acknowledged="handleDisclaimerAcknowledged" />
  <FaqDialog v-if="faqMounted" ref="faqDialogRef" />
  <ExternalLinksSettings v-if="externalLinksMounted" ref="externalLinksSettingsRef" />
  <ApplicationPreferences v-if="preferencesMounted" ref="applicationPreferencesRef" />
  <TagManagementDialog v-if="tagsMounted" ref="tagManagementDialogRef" />
  <DatabaseOverviewDialog v-if="dbOverviewMounted" ref="databaseOverviewDialogRef" />
  <DeleteAllCasesDialog v-if="deleteAllMounted" ref="deleteAllCasesDialogRef" />
  <PanelManagerDialog v-if="panelManagerMounted" v-model="panelManagerOpen" />
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
import { ref, defineAsyncComponent, onMounted, nextTick, watch } from 'vue'
import ImportWizard from './import/ImportWizard.vue'
import AppSnackbar from './AppSnackbar.vue'
import LogViewer from './LogViewer.vue'
import DisclaimerDialog from './DisclaimerDialog.vue'
import CaseMetadataModal from './CaseMetadataModal.vue'

// Lazy-load rarely-used dialogs to reduce initial render cost
const FaqDialog = defineAsyncComponent(() => import('./FaqDialog.vue'))
const ExternalLinksSettings = defineAsyncComponent(() => import('./ExternalLinksSettings.vue'))
const ApplicationPreferences = defineAsyncComponent(() => import('./ApplicationPreferences.vue'))
const TagManagementDialog = defineAsyncComponent(() => import('./TagManagementDialog.vue'))
const DatabaseOverviewDialog = defineAsyncComponent(() => import('./DatabaseOverviewDialog.vue'))
const DeleteAllCasesDialog = defineAsyncComponent(() => import('./DeleteAllCasesDialog.vue'))
const PanelManagerDialog = defineAsyncComponent(() => import('./panels/PanelManagerDialog.vue'))
const VcfImportDialog = defineAsyncComponent(() => import('./import/VcfImportDialog.vue'))
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
const importWizardRef = ref<InstanceType<typeof ImportWizard> | null>(null)
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

// Lazy dialog mount flags — only mount component after first open
const faqMounted = ref(false)
const externalLinksMounted = ref(false)
const preferencesMounted = ref(false)
const tagsMounted = ref(false)
const dbOverviewMounted = ref(false)
const deleteAllMounted = ref(false)
const panelManagerMounted = ref(false)
const panelManagerOpen = ref(false)
const vcfImportMounted = ref(false)
const vcfImportOpen = ref(false)

/**
 * Wait for a lazy-loaded dialog ref to become available after setting its mount flag.
 * defineAsyncComponent loads the chunk asynchronously, so a single nextTick() after
 * setting the v-if flag is insufficient — the ref stays null until the chunk loads,
 * parses, and the component mounts. This watches the ref until it's populated.
 */
function waitForRef<T>(r: ReturnType<typeof ref<T | null>>, timeoutMs = 3000): Promise<T> {
  if (r.value !== null) return Promise.resolve(r.value as T)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop()
      reject(new Error('Dialog component did not mount in time'))
    }, timeoutMs)
    const stop = watch(r, (val) => {
      if (val !== null) {
        clearTimeout(timer)
        stop()
        resolve(val as T)
      }
    })
  })
}

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

const handleVcfCaseImported = (result: {
  caseId: number
  caseName: string
  variantCount: number
}): void => {
  emit('import-complete', result)
  snackbarRef.value?.show(
    `Case imported: ${result.caseName} (${result.variantCount.toLocaleString()} variants)`,
    'success'
  )
}

// Check initial disclaimer acknowledgment state
const { needsAcknowledgment } = useVersionGating()
disclaimerAcknowledged.value = !needsAcknowledgment()

onMounted(() => {
  disclaimerRef.value?.checkAndShow()
})

// Expose dialog triggers for parent coordination
defineExpose({
  showImportDialog: () => importWizardRef.value?.show(),
  showVcfImportDialog: async () => {
    vcfImportMounted.value = true
    await nextTick()
    vcfImportOpen.value = true
  },
  showDisclaimer: () => disclaimerRef.value?.show(),
  showFaq: async () => {
    faqMounted.value = true
    const dialog = await waitForRef(faqDialogRef)
    dialog.show()
  },
  showExternalLinks: async () => {
    externalLinksMounted.value = true
    const dialog = await waitForRef(externalLinksSettingsRef)
    dialog.show()
  },
  showPreferences: async () => {
    preferencesMounted.value = true
    const dialog = await waitForRef(applicationPreferencesRef)
    dialog.show()
  },
  showTagManagement: async () => {
    tagsMounted.value = true
    const dialog = await waitForRef(tagManagementDialogRef)
    dialog.show()
  },
  showDatabaseOverview: async () => {
    dbOverviewMounted.value = true
    const dialog = await waitForRef(databaseOverviewDialogRef)
    dialog.show()
  },
  showDeleteAllCases: async (count: number) => {
    deleteAllMounted.value = true
    const dialog = await waitForRef(deleteAllCasesDialogRef)
    return dialog.show(count)
  },
  showPanelManager: async () => {
    panelManagerMounted.value = true
    // PanelManagerDialog uses v-model, not a ref .show() method
    await nextTick()
    panelManagerOpen.value = true
  },
  showCaseMetadata: () => caseMetadataModalRef.value?.show(),
  showSnackbar: (message: string, type: 'success' | 'error') =>
    snackbarRef.value?.show(message, type),
  reopenImportDialog: () => importWizardRef.value?.reopen(),
  reopenBatchImportDialog: () => importWizardRef.value?.reopen(),
  toggleLogViewer: () => {
    logViewerOpen.value = !logViewerOpen.value
  },
  disclaimerAcknowledged
})
</script>
