<template>
  <v-app>
    <v-app-bar color="primary" density="compact" flat>
      <v-btn
        :icon="sidebarOpen ? 'mdi-chevron-double-left' : 'mdi-chevron-double-right'"
        variant="text"
        size="small"
        :aria-label="sidebarOpen ? 'Close sidebar' : 'Open sidebar'"
        :aria-expanded="sidebarOpen"
        class="sidebar-toggle-btn"
        @click="sidebarOpen = !sidebarOpen"
      />
      <v-app-bar-title
        class="ml-2 text-body-large font-weight-bold flex-grow-0 app-title"
        role="button"
        tabindex="0"
        @click="handleHomeClick"
        @keydown.enter="handleHomeClick"
      >
        VarLens
        <v-tooltip activator="parent" location="bottom">Return to home</v-tooltip>
      </v-app-bar-title>

      <div v-if="showContextIndicator" class="context-indicator mx-3 d-flex align-center">
        <template v-if="activeTab === 'case' && selectedCaseId">
          <CaseStatusIcons
            :status="selectedStatusLabel"
            :sex="selectedSexLabel"
            tooltip-location="bottom"
            class="mr-1"
          />
          <span
            class="text-body-medium font-weight-medium text-truncate context-label clickable-case-name"
            role="button"
            tabindex="0"
            @click="caseMetadataModalRef?.show()"
            @keydown.enter="caseMetadataModalRef?.show()"
          >
            {{ selectedCaseName }}
          </span>
          <v-btn
            icon
            size="x-small"
            variant="text"
            class="ml-1"
            @click="caseMetadataModalRef?.show()"
          >
            <v-icon size="small">mdi-information-outline</v-icon>
            <v-tooltip activator="parent" location="bottom">Case details</v-tooltip>
          </v-btn>
        </template>
        <template v-else-if="activeTab === 'cohort'">
          <v-icon size="small" class="mr-1">mdi-account-group</v-icon>
          <span class="text-body-medium font-weight-medium">
            Cohort ({{ caseCount }} {{ caseCount === 1 ? 'case' : 'cases' }})
          </span>
        </template>
        <template v-else>
          <v-icon size="small" class="mr-1">mdi-account</v-icon>
          <span
            class="text-body-medium text-medium-emphasis select-case-hint"
            role="button"
            tabindex="0"
            @click="sidebarOpen = true"
            @keydown.enter="sidebarOpen = true"
          >
            Select a case...
          </span>
        </template>
      </div>

      <v-spacer />

      <v-btn-toggle
        v-model="activeTab"
        mandatory
        density="compact"
        variant="outlined"
        divided
        color="white"
        class="mode-toggle mr-2"
      >
        <v-btn value="case" size="small">
          <v-icon :start="showModeToggleLabels" size="small">mdi-account</v-icon>
          <span v-if="showModeToggleLabels">Case</span>
        </v-btn>
        <v-btn value="cohort" size="small">
          <v-icon :start="showModeToggleLabels" size="small">mdi-account-group</v-icon>
          <span v-if="showModeToggleLabels">Cohort</span>
        </v-btn>
      </v-btn-toggle>

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
            prepend-icon="mdi-chart-box-outline"
            title="Database Overview"
            @click="databaseOverviewDialogRef?.show()"
          />
          <v-divider class="my-1" />
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
          <v-list-subheader class="danger-zone-subheader">Danger Zone</v-list-subheader>
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

    <v-navigation-drawer v-model="sidebarOpen" :width="sidebarWidth" :scrim="tier === 'narrow'">
      <AppSidebar
        :case-count="caseCount"
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
          @edit-case="handleEditCase"
        />
      </AppSidebar>
      <div
        class="sidebar-resize-handle"
        @mousedown="startSidebarResize"
        @dblclick="resetSidebarWidth"
      />
    </v-navigation-drawer>

    <v-main>
      <router-view />
    </v-main>

    <VariantDetailsPanel
      v-model:open="panelOpen"
      :variant="selectedPanelVariant"
      :case-id="activeTab === 'case' ? selectedCaseId : null"
      :mode="panelMode"
      @variant-updated="variantTableRef?.refresh()"
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
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed, provide } from 'vue'
import { useRouter } from 'vue-router'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import ImportDialog from './components/ImportDialog.vue'
import BatchImportDialog from './components/BatchImportDialog.vue'
import AppSnackbar from './components/AppSnackbar.vue'
import LogViewer from './components/LogViewer.vue'
import AppFooter from './components/AppFooter.vue'
import DisclaimerDialog from './components/DisclaimerDialog.vue'
import FaqDialog from './components/FaqDialog.vue'
import DatabaseOverviewDialog from './components/DatabaseOverviewDialog.vue'
import DatabasePicker from './components/DatabasePicker.vue'
import ExternalLinksSettings from './components/ExternalLinksSettings.vue'
import TagManagementDialog from './components/TagManagementDialog.vue'
import DeleteAllCasesDialog from './components/DeleteAllCasesDialog.vue'
import VariantDetailsPanel from './components/VariantDetailsPanel.vue'
import CaseMetadataModal from './components/CaseMetadataModal.vue'
import { usePanelResize } from './composables/usePanelResize'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useVersionGating } from './composables/useVersionGating'
import { useDatabaseStore } from './stores/databaseStore'
import { useCaseMetadata } from './composables/useCaseMetadata'
import CaseStatusIcons from './components/CaseStatusIcons.vue'
import { useColumnPreferences } from './composables/useColumnPreferences'
import { useFilterPreferences } from './composables/useFilterPreferences'
import { useResponsiveLayout } from './composables/useResponsiveLayout'
import { logService } from './services/LogService'
import { AppStateKey, createAppState } from './composables/useAppState'
import { useApiService } from './composables/useApiService'
import type { AffectedStatus, CaseSex } from '../../shared/types/api'

const router = useRouter()
const { api } = useApiService()

// Create and provide shared app state for child components
const appState = createAppState()
provide(AppStateKey, appState)

const {
  selectedCaseId,
  selectedCaseName,
  selectedVariantCount,
  selectedCreatedAt,
  caseCount,
  activeTab,
  sidebarOpen,
  currentFilters,
  filteredCount,
  totalCount,
  hasSort,
  panelOpen,
  selectedPanelVariant,
  panelMode,
  variantTableRef,
  filterToolbarRef,
  cohortViewRef,
  setSnackbarHandler
} = appState

// Initialize responsive layout
const { tier, showModeToggleLabels, showContextIndicator } = useResponsiveLayout()

// Initialize database store
const databaseStore = useDatabaseStore()

// Initialize case metadata composable for cache clearing
const { getMetadata, clearCache: clearMetadataCache } = useCaseMetadata()

// Computed metadata labels for selected case in top bar
const selectedStatusLabel = computed<AffectedStatus>(() => {
  if (selectedCaseId.value == null) return 'unknown'
  const meta = getMetadata(selectedCaseId.value)
  return meta?.metadata?.affected_status ?? 'unknown'
})
const selectedSexLabel = computed<CaseSex>(() => {
  if (selectedCaseId.value == null) return 'unknown'
  const meta = getMetadata(selectedCaseId.value)
  return meta?.metadata?.sex ?? 'unknown'
})

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
  if (!api) {
    return
  }

  const confirmed = await deleteAllCasesDialogRef.value?.show(caseCount.value)

  if (confirmed === true) {
    const deleted = await api.cases.deleteAll()

    selectedCaseId.value = null
    selectedCaseName.value = ''

    await caseListRef.value?.refreshCases()

    snackbarRef.value?.show(`Deleted ${deleted} ${deleted === 1 ? 'case' : 'cases'}`, 'success')
  }
}

// Component refs (local to App.vue shell)
const importDialogRef = ref<InstanceType<typeof ImportDialog> | null>(null)
const batchImportDialogRef = ref<InstanceType<typeof BatchImportDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)
const caseListRef = ref<InstanceType<typeof CaseList> | null>(null)
const disclaimerRef = ref<InstanceType<typeof DisclaimerDialog> | null>(null)
const faqDialogRef = ref<InstanceType<typeof FaqDialog> | null>(null)
const externalLinksSettingsRef = ref<InstanceType<typeof ExternalLinksSettings> | null>(null)
const tagManagementDialogRef = ref<InstanceType<typeof TagManagementDialog> | null>(null)
const deleteAllCasesDialogRef = ref<InstanceType<typeof DeleteAllCasesDialog> | null>(null)
const databaseOverviewDialogRef = ref<InstanceType<typeof DatabaseOverviewDialog> | null>(null)
const caseMetadataModalRef = ref<InstanceType<typeof CaseMetadataModal> | null>(null)

// Register snackbar handler for cross-component communication
setSnackbarHandler((message: string, type: string, options?: Record<string, unknown>) => {
  snackbarRef.value?.show(message, type as 'success' | 'error', options)
})

// Sidebar resize
const {
  panelWidth: sidebarWidth,
  startResize: startSidebarResize,
  resetWidth: resetSidebarWidth
} = usePanelResize({
  side: 'left',
  storageKey: 'varlens_sidebar_width',
  defaultWidth: 280,
  minWidth: 200,
  maxWidth: 450,
  collapseThreshold: 180,
  onCollapse: () => {
    sidebarOpen.value = false
  }
})

// Log viewer state
const logViewerOpen = ref(false)

// Disclaimer acknowledgment state
const disclaimerAcknowledged = ref(false)

const handleHomeClick = (): void => {
  selectedCaseId.value = null
  selectedCaseName.value = ''
  activeTab.value = 'case'
  sidebarOpen.value = true
  router.push('/case')
}

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
  await caseListRef.value?.refreshCases()
  caseListRef.value?.selectCase(result.caseId)
  snackbarRef.value?.show(
    `Case imported: ${result.caseName} (${result.variantCount.toLocaleString()} variants)`,
    'success'
  )
}

const handleBatchImportComplete = async (result: { totalImported: number }): Promise<void> => {
  await caseListRef.value?.refreshCases()
  const message =
    result.totalImported === 1
      ? 'Batch import complete: 1 case imported'
      : `Batch import complete: ${result.totalImported} cases imported`
  snackbarRef.value?.show(message, 'success')
}

const handleCaseSelected = (
  caseId: number,
  caseName: string,
  variantCount: number,
  createdAt: number
): void => {
  selectedCaseId.value = caseId
  selectedCaseName.value = caseName
  selectedVariantCount.value = variantCount
  selectedCreatedAt.value = createdAt
  activeTab.value = 'case'
  sidebarOpen.value = false
  router.push('/case')
}

const handleEditCase = (
  caseId: number,
  caseName: string,
  variantCount: number,
  createdAt: number
): void => {
  selectedCaseId.value = caseId
  selectedCaseName.value = caseName
  selectedVariantCount.value = variantCount
  selectedCreatedAt.value = createdAt
  caseMetadataModalRef.value?.show()
}

const handleCasesLoaded = (count: number): void => {
  caseCount.value = count
}

const handleCaseDeleted = (caseId: number): void => {
  if (selectedCaseId.value === caseId) {
    selectedCaseId.value = null
  }
}

// Sync activeTab with router
watch(activeTab, async (newTab) => {
  panelOpen.value = false
  selectedPanelVariant.value = null
  if (newTab === 'cohort') {
    sidebarOpen.value = false
    router.push('/cohort')
    await cohortViewRef.value?.refresh()
  } else {
    router.push('/case')
  }
})

// Clear filters on case change
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
    activeTab.value = 'case'
  }
)

// Setup keyboard shortcuts
useKeyboardShortcuts({
  onDisclaimer: () => disclaimerRef.value?.show(),
  onFaq: () => faqDialogRef.value?.show(),
  onLogViewer: () => {
    logViewerOpen.value = !logViewerOpen.value
  },
  onToggleFilterDrawer: () => filterToolbarRef.value?.toggleFilterDrawer(),
  onToggleColumnsDrawer: () => filterToolbarRef.value?.toggleColumnsDrawer()
})

const handleDisclaimerAcknowledged = (): void => {
  disclaimerAcknowledged.value = true
  logService.info('Research disclaimer acknowledged', 'App')
}

const handleDatabaseSwitched = async (): Promise<void> => {
  selectedCaseId.value = null
  selectedCaseName.value = ''
  currentFilters.value = {}
  filteredCount.value = 0
  totalCount.value = 0
  hasSort.value = false
  clearMetadataCache()
  await caseListRef.value?.refreshCases()
  snackbarRef.value?.show(`Switched to ${databaseStore.currentName}`, 'success')
}

const handleDatabaseError = (message: string): void => {
  snackbarRef.value?.show(message, 'error')
}

// Check initial disclaimer acknowledgment state
const { needsAcknowledgment } = useVersionGating()
disclaimerAcknowledged.value = !needsAcknowledgment()

// Lifecycle
onMounted(async () => {
  logService.setupMainProcessListener()
  await databaseStore.fetchInfo()
  disclaimerRef.value?.checkAndShow()
})
</script>

<style scoped>
.filter-bar-container {
  background: rgb(var(--v-theme-surface));
}

.context-indicator {
  min-width: 0;
}

.context-label {
  max-width: 200px;
}

.clickable-case-name {
  cursor: pointer;
}

.clickable-case-name:hover {
  text-decoration: underline;
}

.app-title {
  cursor: pointer;
}

.app-title:hover {
  text-decoration: underline;
}

.select-case-hint {
  cursor: pointer;
}

.select-case-hint:hover {
  text-decoration: underline;
}

.danger-zone-subheader {
  color: rgb(var(--v-theme-error)) !important;
  font-weight: 600;
}

.mode-toggle {
  height: 32px;
}

.mode-toggle :deep(.v-btn--active) {
  background-color: rgba(255, 255, 255, 0.3) !important;
  font-weight: 600;
  border-bottom: 2px solid rgba(255, 255, 255, 0.8);
}

.mode-toggle :deep(.v-btn:not(.v-btn--active)) {
  opacity: 0.7;
}

.case-content {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px - 32px);
  overflow: hidden;
}

:deep(.v-main) {
  --v-layout-top: 0px !important;
  padding-top: 48px !important;
}

:deep(.v-window) {
  height: 100%;
}

:deep(.v-window__container) {
  height: 100%;
}

:deep(.v-window-item) {
  height: 100%;
}

.sidebar-toggle-btn :deep(.v-icon) {
  transition: transform 0.2s ease-in-out;
}

.sidebar-resize-handle {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 10;
  transition: background-color 0.15s ease;
}

.sidebar-resize-handle:hover {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 20%, transparent);
}
</style>
