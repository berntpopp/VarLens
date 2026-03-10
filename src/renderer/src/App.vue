<template>
  <v-app>
    <AppToolbar
      @show-case-metadata="dialogHostRef?.showCaseMetadata()"
      @show-database-overview="dialogHostRef?.showDatabaseOverview()"
      @show-external-links="dialogHostRef?.showExternalLinks()"
      @show-tag-management="dialogHostRef?.showTagManagement()"
      @reset-columns="handleResetColumns"
      @reset-filters="handleResetFilters"
      @delete-all-cases="handleDeleteAllCases"
      @database-switched="handleDatabaseSwitched"
      @database-error="handleDatabaseError"
    />

    <v-navigation-drawer v-model="sidebarOpen" :width="sidebarWidth" :scrim="tier === 'narrow'">
      <AppSidebar
        :case-count="caseCount"
        @import-click="dialogHostRef?.showImportDialog()"
        @batch-import-files="dialogHostRef?.showBatchImportDialog('files')"
        @batch-import-folder="dialogHostRef?.showBatchImportDialog('folder')"
        @batch-import-zip="dialogHostRef?.showBatchImportDialog('zip')"
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
      :disclaimer-acknowledged="dialogHostRef?.disclaimerAcknowledged ?? false"
      @toggle-log-viewer="dialogHostRef?.toggleLogViewer()"
      @open-disclaimer="dialogHostRef?.showDisclaimer()"
      @open-faq="dialogHostRef?.showFaq()"
    />

    <AppDialogHost
      ref="dialogHostRef"
      @import-complete="handleImportComplete"
      @batch-import-complete="handleBatchImportComplete"
    />
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, provide } from 'vue'
import { useRouter } from 'vue-router'
import AppToolbar from './components/AppToolbar.vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import AppFooter from './components/AppFooter.vue'
import AppDialogHost from './components/AppDialogHost.vue'
import VariantDetailsPanel from './components/VariantDetailsPanel.vue'
import { usePanelResize } from './composables/usePanelResize'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useDatabaseStore } from './stores/databaseStore'
import { useCaseMetadata } from './composables/useCaseMetadata'
import { useColumnPreferences } from './composables/useColumnPreferences'
import { useFilterPreferences } from './composables/useFilterPreferences'
import { useResponsiveLayout } from './composables/useResponsiveLayout'
import { logService } from './services/LogService'
import { AppStateKey, createAppState } from './composables/useAppState'
import { useApiService } from './composables/useApiService'

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
  cohortViewRef
} = appState

// Responsive layout
const { tier } = useResponsiveLayout()

// Database store
const databaseStore = useDatabaseStore()

// Case metadata
const { clearCache: clearMetadataCache } = useCaseMetadata()

// Preference resets
const { resetToDefaults: resetVariantColumns } = useColumnPreferences('variant-table')
const { resetToDefaults: resetCohortColumns } = useColumnPreferences('cohort-table')
const { resetToDefaults: resetFilterPreferences } = useFilterPreferences()

// Component refs
const dialogHostRef = ref<InstanceType<typeof AppDialogHost> | null>(null)
const caseListRef = ref<InstanceType<typeof CaseList> | null>(null)

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

// Settings menu handlers
const handleResetColumns = () => {
  resetVariantColumns()
  resetCohortColumns()
}
const handleResetFilters = () => {
  resetFilterPreferences()
}

const handleDeleteAllCases = async () => {
  if (!api) return
  const confirmed = await dialogHostRef.value?.showDeleteAllCases(caseCount.value)
  if (confirmed === true) {
    const deleted = await api.cases.deleteAll()
    selectedCaseId.value = null
    selectedCaseName.value = ''
    await caseListRef.value?.refreshCases()
    dialogHostRef.value?.showSnackbar(
      `Deleted ${deleted} ${deleted === 1 ? 'case' : 'cases'}`,
      'success'
    )
  }
}

// Case list handlers
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
  dialogHostRef.value?.showCaseMetadata()
}

const handleCasesLoaded = (count: number): void => {
  caseCount.value = count
}
const handleCaseDeleted = (caseId: number): void => {
  if (selectedCaseId.value === caseId) selectedCaseId.value = null
}

// Import handlers
const handleImportComplete = async (result: {
  caseId: number
  variantCount: number
  caseName: string
}): Promise<void> => {
  await caseListRef.value?.refreshCases()
  caseListRef.value?.selectCase(result.caseId)
}

const handleBatchImportComplete = async (): Promise<void> => {
  await caseListRef.value?.refreshCases()
}

// Tab/route sync
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

// Database switch handler
const handleDatabaseSwitched = async (): Promise<void> => {
  selectedCaseId.value = null
  selectedCaseName.value = ''
  currentFilters.value = {}
  filteredCount.value = 0
  totalCount.value = 0
  hasSort.value = false
  clearMetadataCache()
  await caseListRef.value?.refreshCases()
  dialogHostRef.value?.showSnackbar(`Switched to ${databaseStore.currentName}`, 'success')
}

const handleDatabaseError = (message: string): void => {
  dialogHostRef.value?.showSnackbar(message, 'error')
}

// Keyboard shortcuts
useKeyboardShortcuts({
  onDisclaimer: () => dialogHostRef.value?.showDisclaimer(),
  onFaq: () => dialogHostRef.value?.showFaq(),
  onLogViewer: () => dialogHostRef.value?.toggleLogViewer(),
  onToggleFilterDrawer: () => filterToolbarRef.value?.toggleFilterDrawer(),
  onToggleColumnsDrawer: () => filterToolbarRef.value?.toggleColumnsDrawer()
})

// Lifecycle
onMounted(async () => {
  logService.setupMainProcessListener()
  await databaseStore.fetchInfo()
})
</script>

<style scoped>
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
