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
      <v-menu>
        <template #activator="{ props }">
          <v-btn icon size="small" v-bind="props">
            <v-icon>mdi-cog</v-icon>
            <v-tooltip activator="parent" location="bottom">Settings</v-tooltip>
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item
            prepend-icon="mdi-link"
            title="External Links"
            @click="externalLinksSettingsRef?.show()"
          />
          <v-list-item
            prepend-icon="mdi-tag-multiple"
            title="Custom Tags"
            @click="tagManagementDialogRef?.show()"
          />
          <v-divider class="my-1" />
          <v-list-subheader>Reset Preferences</v-list-subheader>
          <v-list-item
            prepend-icon="mdi-table-column"
            title="Reset Columns"
            subtitle="Restore default column visibility and order"
            @click="handleResetColumns"
          />
          <v-list-item
            prepend-icon="mdi-filter-off"
            title="Reset Filters"
            subtitle="Restore default filter group arrangement"
            @click="handleResetFilters"
          />
          <v-divider class="my-1" />
          <v-list-subheader>Danger Zone</v-list-subheader>
          <v-list-item @click="handleDeleteAllCases">
            <template #prepend>
              <v-icon color="error">mdi-delete-sweep</v-icon>
            </template>
            <v-list-item-title>Delete All Cases</v-list-item-title>
            <v-list-item-subtitle>Remove all cases from database</v-list-item-subtitle>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-app-bar>

    <v-navigation-drawer v-model="sidebarOpen" :width="280">
      <AppSidebar
        @import-click="handleImportClick"
        @batch-import-files="handleBatchImportFiles"
        @batch-import-folder="handleBatchImportFolder"
        @batch-import-zip="handleBatchImportZip"
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
      <v-tabs
        v-model="activeTab"
        bg-color="secondary"
        density="compact"
        class="border-b sticky-tabs"
      >
        <v-tab value="case" prepend-icon="mdi-account">Case Analysis</v-tab>
        <v-tab value="cohort" prepend-icon="mdi-account-group">Cohort Analysis</v-tab>
      </v-tabs>

      <v-window v-model="activeTab">
        <v-window-item value="case">
          <EmptyState
            v-if="!selectedCaseId"
            :has-cases="caseCount > 0"
            @import="handleImportClick"
          />
          <template v-else>
            <div class="filter-bar-container">
              <div class="case-header d-flex align-center px-3 py-1 border-b">
                <span class="text-subtitle-2 font-weight-medium">{{ selectedCaseName }}</span>
                <CaseMetadataModal
                  :case-id="selectedCaseId"
                  :case-name="selectedCaseName"
                  class="ml-2"
                />
              </div>
              <FilterToolbar
                :case-id="selectedCaseId"
                :case-name="selectedCaseName"
                :filtered-count="filteredCount"
                :total-count="totalCount"
                :has-sort="hasSort"
                :initial-search="initialSearch"
                :columns="variantTableRef?.columns"
                @update:filters="handleFiltersUpdate"
                @reset-sort="handleResetSort"
              />
            </div>
            <VariantTable
              ref="variantTableRef"
              :case-id="selectedCaseId"
              :filters="currentFilters"
              @update:counts="handleCountsUpdate"
              @update:has-sort="handleSortUpdate"
              @row-click="handleVariantRowClick"
            />
          </template>
        </v-window-item>

        <v-window-item value="cohort">
          <CohortView
            ref="cohortViewRef"
            @navigate-to-case="handleNavigateToCase"
            @row-click="handleVariantRowClick"
          />
        </v-window-item>
      </v-window>
    </v-main>

    <VariantDetailsPanel
      v-model:open="panelOpen"
      :variant="selectedPanelVariant"
      :case-id="activeTab === 'case' ? selectedCaseId : null"
      :mode="panelMode"
    />

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
    <TagManagementDialog ref="tagManagementDialogRef" />
    <DeleteAllCasesDialog ref="deleteAllCasesDialogRef" />
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
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
import TagManagementDialog from './components/TagManagementDialog.vue'
import DeleteAllCasesDialog from './components/DeleteAllCasesDialog.vue'
import CohortView from './components/CohortView.vue'
import VariantDetailsPanel from './components/VariantDetailsPanel.vue'
import CaseMetadataModal from './components/CaseMetadataModal.vue'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useVersionGating } from './composables/useVersionGating'
import { useDatabaseStore } from './stores/databaseStore'
import { useCaseMetadata } from './composables/useCaseMetadata'
import { useColumnPreferences } from './composables/useColumnPreferences'
import { useFilterPreferences } from './composables/useFilterPreferences'
import { logService } from './services/LogService'
import type { VariantFilter, Variant } from '../../shared/types/api'
import type { CohortVariant } from '../../shared/types/cohort'

// Initialize database store
const databaseStore = useDatabaseStore()

// Initialize case metadata composable for cache clearing
const { clearCache: clearMetadataCache } = useCaseMetadata()

// Initialize preference reset functions
const { resetToDefaults: resetVariantColumns } = useColumnPreferences('variant-table')
const { resetToDefaults: resetCohortColumns } = useColumnPreferences('cohort-table')
const { resetToDefaults: resetFilterPreferences } = useFilterPreferences()

const handleResetColumns = () => {
  resetVariantColumns()
  resetCohortColumns()
}

const handleResetFilters = () => {
  resetFilterPreferences()
}

const handleDeleteAllCases = async () => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    return
  }

  const confirmed = await deleteAllCasesDialogRef.value?.show(caseCount.value)

  if (confirmed === true) {
    // eslint-disable-next-line no-undef
    const deleted = await window.api.cases.deleteAll()

    // Clear selection if current case was deleted
    selectedCaseId.value = null
    selectedCaseName.value = ''

    // Refresh case list
    await caseListRef.value?.refreshCases()

    // Show success snackbar
    snackbarRef.value?.show(`Deleted ${deleted} ${deleted === 1 ? 'case' : 'cases'}`, 'success')
  }
}

// Component refs
const importDialogRef = ref<InstanceType<typeof ImportDialog> | null>(null)
const batchImportDialogRef = ref<InstanceType<typeof BatchImportDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)
const caseListRef = ref<InstanceType<typeof CaseList> | null>(null)
const variantTableRef = ref<InstanceType<typeof VariantTable> | null>(null)
const disclaimerRef = ref<InstanceType<typeof DisclaimerDialog> | null>(null)
const faqDialogRef = ref<InstanceType<typeof FaqDialog> | null>(null)
const externalLinksSettingsRef = ref<InstanceType<typeof ExternalLinksSettings> | null>(null)
const tagManagementDialogRef = ref<InstanceType<typeof TagManagementDialog> | null>(null)
const deleteAllCasesDialogRef = ref<InstanceType<typeof DeleteAllCasesDialog> | null>(null)
const cohortViewRef = ref<InstanceType<typeof CohortView> | null>(null)

// Sidebar state
const sidebarOpen = ref(true)

// Log viewer state
const logViewerOpen = ref(false)

// Disclaimer acknowledgment state (reactive, passed to AppFooter)
const disclaimerAcknowledged = ref(false)

// Tab state
const activeTab = ref<'case' | 'cohort'>('case')

// Case selection state
const selectedCaseId = ref<number | null>(null)
const selectedCaseName = ref<string>('')
const caseCount = ref(0)

// Panel state
const panelOpen = ref(false)
const selectedPanelVariant = ref<Variant | CohortVariant | null>(null)

// Filter state (lifted to App for coordination)
const currentFilters = ref<Omit<VariantFilter, 'case_id'>>({})
const filteredCount = ref(0)
const totalCount = ref(0)
const hasSort = ref(false)
const initialSearch = ref<string | undefined>(undefined)

// Computed panel mode
const panelMode = computed(() => (activeTab.value === 'case' ? 'case' : 'cohort'))

const handleImportClick = (): void => {
  importDialogRef.value?.show()
}

const handleBatchImportFiles = (): void => {
  batchImportDialogRef.value?.show('files')
}

const handleBatchImportFolder = (): void => {
  batchImportDialogRef.value?.show('folder')
}

const handleBatchImportZip = (): void => {
  batchImportDialogRef.value?.show('zip')
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
  // Clear initialSearch once the search filter has been applied (prevent re-applying on re-render)
  if (initialSearch.value !== undefined && filters.search_query != null) {
    initialSearch.value = undefined
  }
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

// Handle variant row click from tables
const handleVariantRowClick = (variant: Variant | CohortVariant): void => {
  selectedPanelVariant.value = variant
  panelOpen.value = true
}

// Handle navigation from cohort to case
const handleNavigateToCase = async (payload: {
  caseId: number
  chr: string
  pos: number
  ref: string
  alt: string
  geneSymbol: string | null
  cdna: string | null
}): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    return
  }

  // Build a human-readable search from gene symbol and/or cDNA notation
  // e.g. "BRCA1 AND c.4308T>C" or just "BRCA1" or just "c.4308T>C"
  const parts: string[] = []
  if (payload.geneSymbol != null && payload.geneSymbol !== '') {
    parts.push(payload.geneSymbol)
  }
  if (payload.cdna != null && payload.cdna !== '') {
    parts.push(payload.cdna)
  }
  const variantSearch = parts.length > 0 ? parts.join(' AND ') : undefined

  // Set the initial search BEFORE switching case (so the watch on selectedCaseId
  // clears filters but initialSearch survives via the immediate watcher in FilterToolbar)
  initialSearch.value = variantSearch

  // Switch to case tab
  activeTab.value = 'case'

  // Set selected case ID
  selectedCaseId.value = payload.caseId

  // Look up case name from the case list
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const cases = await (window as any).api.cases.list()
    const selectedCase = cases.find((c: { id: number }) => c.id === payload.caseId)
    if (selectedCase !== undefined) {
      selectedCaseName.value = selectedCase.name
    }
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to fetch case name:', error)
  }
}

// Clear filters and sort on case change (initialSearch survives for cohort navigation)
watch(selectedCaseId, () => {
  currentFilters.value = {}
  hasSort.value = false
})

// Refresh cohort data when switching to cohort tab
// Also close panel on tab switch
watch(activeTab, async (newTab) => {
  panelOpen.value = false
  selectedPanelVariant.value = null
  if (newTab === 'cohort') {
    await cohortViewRef.value?.refresh()
  }
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
    activeTab.value = 'case'
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

  // Clear metadata cache
  clearMetadataCache()

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

<style scoped>
.sticky-tabs {
  position: sticky;
  top: 0;
  z-index: 4;
  background: rgb(var(--v-theme-secondary));
}

.filter-bar-container {
  background: rgb(var(--v-theme-surface));
}

.case-header {
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
}

/* Remove v-main automatic padding-top from app-bar */
:deep(.v-main) {
  --v-layout-top: 0px !important;
  padding-top: 48px !important; /* Only app-bar height */
}
</style>
