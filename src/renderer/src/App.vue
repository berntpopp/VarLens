<template>
  <v-app>
    <v-app-bar color="primary" density="compact" flat>
      <v-app-bar-nav-icon
        aria-label="Toggle navigation sidebar"
        @click="sidebarOpen = !sidebarOpen"
      />
      <v-icon icon="custom:varlens-dna" class="ml-2" size="small" />
      <v-app-bar-title class="ml-2 text-subtitle-1 font-weight-bold"> VarLens </v-app-bar-title>
      <DatabasePicker @database-switched="handleDatabaseSwitched" @error="handleDatabaseError" />
      <v-btn icon size="small" @click="externalLinksSettingsRef?.show()">
        <v-icon>mdi-cog</v-icon>
        <v-tooltip activator="parent" location="bottom">Settings</v-tooltip>
      </v-btn>
    </v-app-bar>

    <v-navigation-drawer v-model="sidebarOpen" :width="280">
      <AppSidebar
        @import-click="handleImportClick"
        @batch-import-files="handleBatchImportFiles"
        @batch-import-folder="handleBatchImportFolder"
      >
        <CaseList
          ref="caseListRef"
          @case-selected="handleCaseSelected"
          @case-deleted="handleCaseDeleted"
          @cases-loaded="handleCasesLoaded"
        />
      </AppSidebar>
    </v-navigation-drawer>

    <v-main>
      <EmptyState v-if="!selectedCaseId" :has-cases="caseCount > 0" @import="handleImportClick" />
      <template v-else>
        <FilterToolbar
          :case-id="selectedCaseId"
          :case-name="selectedCaseName"
          :filtered-count="filteredCount"
          :total-count="totalCount"
          :has-sort="hasSort"
          @update:filters="handleFiltersUpdate"
          @reset-sort="handleResetSort"
        />
        <VariantTable
          ref="variantTableRef"
          :case-id="selectedCaseId"
          :filters="currentFilters"
          @update:counts="handleCountsUpdate"
          @update:has-sort="handleSortUpdate"
        />
      </template>
    </v-main>

    <AppFooter
      :disclaimer-acknowledged="disclaimerAcknowledged"
      @toggle-log-viewer="logViewerOpen = !logViewerOpen"
      @open-disclaimer="disclaimerRef?.show()"
      @open-faq="faqDialogRef?.show()"
    />

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
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import EmptyState from './components/EmptyState.vue'
import VariantTable from './components/VariantTable.vue'
import FilterToolbar from './components/FilterToolbar.vue'
import ImportDialog from './components/ImportDialog.vue'
import BatchImportDialog from './components/BatchImportDialog.vue'
import AppSnackbar from './components/AppSnackbar.vue'
import LogViewer from './components/LogViewer.vue'
import AppFooter from './components/AppFooter.vue'
import DisclaimerDialog from './components/DisclaimerDialog.vue'
import FaqDialog from './components/FaqDialog.vue'
import DatabasePicker from './components/DatabasePicker.vue'
import ExternalLinksSettings from './components/ExternalLinksSettings.vue'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useVersionGating } from './composables/useVersionGating'
import { useDatabaseStore } from './stores/databaseStore'
import { logService } from './services/LogService'
import type { VariantFilter } from '../../shared/types/api'

// Initialize database store
const databaseStore = useDatabaseStore()

// Component refs
const importDialogRef = ref<InstanceType<typeof ImportDialog> | null>(null)
const batchImportDialogRef = ref<InstanceType<typeof BatchImportDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)
const caseListRef = ref<InstanceType<typeof CaseList> | null>(null)
const variantTableRef = ref<InstanceType<typeof VariantTable> | null>(null)
const disclaimerRef = ref<InstanceType<typeof DisclaimerDialog> | null>(null)
const faqDialogRef = ref<InstanceType<typeof FaqDialog> | null>(null)
const externalLinksSettingsRef = ref<InstanceType<typeof ExternalLinksSettings> | null>(null)

// Sidebar state
const sidebarOpen = ref(true)

// Log viewer state
const logViewerOpen = ref(false)

// Disclaimer acknowledgment state (reactive, passed to AppFooter)
const disclaimerAcknowledged = ref(false)

// Case selection state
const selectedCaseId = ref<number | null>(null)
const selectedCaseName = ref<string>('')
const caseCount = ref(0)

// Filter state (lifted to App for coordination)
const currentFilters = ref<Omit<VariantFilter, 'case_id'>>({})
const filteredCount = ref(0)
const totalCount = ref(0)
const hasSort = ref(false)

const handleImportClick = (): void => {
  importDialogRef.value?.show()
}

const handleBatchImportFiles = (): void => {
  batchImportDialogRef.value?.show('files')
}

const handleBatchImportFolder = (): void => {
  batchImportDialogRef.value?.show('folder')
}

const handleImportComplete = async (result: {
  caseId: number
  variantCount: number
  caseName: string
}): Promise<void> => {
  // Refresh case list to include new case
  await caseListRef.value?.refreshCases()

  // Auto-select the newly imported case
  caseListRef.value?.selectCase(result.caseId)

  // Show success snackbar
  snackbarRef.value?.show(
    `Case imported: ${result.caseName} (${result.variantCount.toLocaleString()} variants)`,
    'success'
  )
}

const handleBatchImportComplete = async (result: { totalImported: number }): Promise<void> => {
  // Refresh case list to include new cases
  await caseListRef.value?.refreshCases()

  // Show success snackbar
  const message =
    result.totalImported === 1
      ? 'Batch import complete: 1 case imported'
      : `Batch import complete: ${result.totalImported} cases imported`
  snackbarRef.value?.show(message, 'success')
}

const handleCaseSelected = (caseId: number, caseName: string): void => {
  selectedCaseId.value = caseId
  selectedCaseName.value = caseName
}

const handleCasesLoaded = (count: number): void => {
  caseCount.value = count
}

const handleCaseDeleted = (caseId: number): void => {
  // If deleted case was selected, clear selection
  if (selectedCaseId.value === caseId) {
    selectedCaseId.value = null
  }
}

const handleFiltersUpdate = (filters: Omit<VariantFilter, 'case_id'>): void => {
  currentFilters.value = filters
}

const handleResetSort = (): void => {
  variantTableRef.value?.resetSort()
}

const handleCountsUpdate = (counts: { filtered: number; total: number }): void => {
  filteredCount.value = counts.filtered
  totalCount.value = counts.total
}

const handleSortUpdate = (sortActive: boolean): void => {
  hasSort.value = sortActive
}

// Clear filters and sort on case change
watch(selectedCaseId, () => {
  currentFilters.value = {}
  hasSort.value = false
})

// Clear UI state when database path changes
watch(
  () => databaseStore.currentPath,
  () => {
    selectedCaseId.value = null
    selectedCaseName.value = ''
    currentFilters.value = {}
    filteredCount.value = 0
    totalCount.value = 0
    hasSort.value = false
  }
)

// Setup keyboard shortcuts
useKeyboardShortcuts({
  onDisclaimer: () => disclaimerRef.value?.show(),
  onFaq: () => faqDialogRef.value?.show(),
  onLogViewer: () => {
    logViewerOpen.value = !logViewerOpen.value
  }
})

const handleDisclaimerAcknowledged = (): void => {
  disclaimerAcknowledged.value = true
  logService.info('Research disclaimer acknowledged', 'App')
}

const handleDatabaseSwitched = async (): Promise<void> => {
  // Clear current case selection
  selectedCaseId.value = null
  selectedCaseName.value = ''

  // Clear filters and counts
  currentFilters.value = {}
  filteredCount.value = 0
  totalCount.value = 0
  hasSort.value = false

  // Refresh case list with new database
  await caseListRef.value?.refreshCases()

  // Show success snackbar
  snackbarRef.value?.show(`Switched to ${databaseStore.currentName}`, 'success')
}

const handleDatabaseError = (message: string): void => {
  // Show error snackbar
  snackbarRef.value?.show(message, 'error')
}

// Check initial disclaimer acknowledgment state
const { needsAcknowledgment } = useVersionGating()
disclaimerAcknowledged.value = !needsAcknowledgment()

// Lifecycle
onMounted(async () => {
  // Load current database info
  await databaseStore.fetchInfo()

  // Check disclaimer acknowledgment on startup
  disclaimerRef.value?.checkAndShow()
})
</script>
