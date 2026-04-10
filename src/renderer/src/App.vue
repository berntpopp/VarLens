<template>
  <v-app>
    <AppToolbar
      @show-case-metadata="dialogHostRef?.showCaseMetadata()"
      @show-database-overview="dialogHostRef?.showDatabaseOverview()"
      @import-click="dialogHostRef?.showImportDialog()"
      @vcf-import-click="dialogHostRef?.showVcfImportDialog()"
      @show-external-links="dialogHostRef?.showExternalLinks()"
      @show-tag-management="dialogHostRef?.showTagManagement()"
      @show-panel-manager="dialogHostRef?.showPanelManager()"
      @show-preferences="dialogHostRef?.showPreferences()"
      @reset-columns="handleResetColumns"
      @reset-filters="handleResetFilters"
      @delete-all-cases="handleDeleteAllCases"
      @show-import-progress="handleShowImportProgress"
      @database-switched="handleDatabaseSwitched"
      @database-error="handleDatabaseError"
    />

    <v-navigation-drawer v-model="sidebarOpen" :width="sidebarWidth" :scrim="tier === 'narrow'">
      <AppSidebar :case-count="caseCount" @import-click="dialogHostRef?.showImportDialog()">
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
      <router-view v-slot="{ Component }">
        <keep-alive :max="2">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </v-main>

    <ImportStatusBar @expand="handleShowImportProgress" @cancel="handleCancelImport" />

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
      @open-shortcuts-help="showKeyboardHelp = true"
    />

    <AppDialogHost
      ref="dialogHostRef"
      @import-complete="handleImportComplete"
      @batch-import-complete="handleBatchImportComplete"
    />

    <KeyboardShortcutsDialog v-model="showKeyboardHelp" />

    <ViewTransitionOverlay :model-value="transitioning" />
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, provide, nextTick, defineAsyncComponent } from 'vue'
import { useRouter } from 'vue-router'
import AppToolbar from './components/AppToolbar.vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import AppFooter from './components/AppFooter.vue'
import type AppDialogHostType from './components/AppDialogHost.vue'
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
import { useImportStatusStore } from './stores/importStatusStore'

const ImportStatusBar = defineAsyncComponent(() => import('./components/ImportStatusBar.vue'))
const VariantDetailsPanel = defineAsyncComponent(
  () => import('./components/VariantDetailsPanel.vue')
)
const AppDialogHost = defineAsyncComponent(() => import('./components/AppDialogHost.vue'))
const KeyboardShortcutsDialog = defineAsyncComponent(
  () => import('./components/KeyboardShortcutsDialog.vue')
)
const ViewTransitionOverlay = defineAsyncComponent(
  () => import('./components/ViewTransitionOverlay.vue')
)
const router = useRouter()
const { api } = useApiService()
const importStore = useImportStatusStore()

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
  dataGeneration
} = appState

// Keyboard shortcuts help dialog
const showKeyboardHelp = ref(false)

// View transition overlay
const transitioning = ref(false)

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
const dialogHostRef = ref<InstanceType<typeof AppDialogHostType> | null>(null)
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
    dataGeneration.value++
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
  dataGeneration.value++
}

// Import handlers
const handleImportComplete = async (result: {
  caseId: number
  variantCount: number
  caseName: string
}): Promise<void> => {
  dataGeneration.value++
  await caseListRef.value?.refreshCases()
  caseListRef.value?.selectCase(result.caseId)
}

const handleBatchImportComplete = async (): Promise<void> => {
  dataGeneration.value++
  await caseListRef.value?.refreshCases()
}

// Tab/route sync
watch(activeTab, async (newTab) => {
  panelOpen.value = false
  selectedPanelVariant.value = null
  transitioning.value = true
  try {
    if (newTab === 'cohort') {
      sidebarOpen.value = false
      await router.push('/cohort')
    } else {
      await router.push('/case')
    }
  } finally {
    // Allow a tick for onActivated to fire before hiding overlay
    await nextTick()
    transitioning.value = false
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

const handleShowImportProgress = (): void => {
  dialogHostRef.value?.reopenImportDialog()
  dialogHostRef.value?.reopenBatchImportDialog()
}

const handleCancelImport = async (): Promise<void> => {
  await api?.import.cancel()
  await api?.batchImport.cancel()
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
  onToggleColumnsDrawer: () => filterToolbarRef.value?.toggleColumnsDrawer(),
  onSearchFocus: () => filterToolbarRef.value?.focusSearch(),
  onHelp: () => {
    showKeyboardHelp.value = true
  },
  onClearAllFilters: () => filterToolbarRef.value?.handleClearAll(),
  onImport: () => dialogHostRef.value?.showImportDialog()
})

// Global listener for background import completion
// This fires even when BatchImportDialog is closed via "Continue in Background"
let cleanupImportComplete: (() => void) | null = null

// Lifecycle
onMounted(() => {
  logService.setupMainProcessListener()

  // Fire-and-forget: fetch database info without blocking the initial render.
  // The UI will show immediately and the data will arrive on the next tick.
  databaseStore.fetchInfo().catch((error) => {
    logService.error(
      'Failed to fetch database info: ' + (error instanceof Error ? error.message : String(error)),
      'app'
    )
  })

  // Report to main process that renderer is interactive
  if (import.meta.env.DEV) {
    api?.perf?.reportInteractive()
  }

  if (api) {
    cleanupImportComplete = api.batchImport.onComplete((result) => {
      // Update the import store so the status bar reflects completion
      importStore.importComplete({
        ...result,
        details: result.details.map((d) => ({
          ...d,
          caseName: d.caseName ?? d.fileName,
          status: d.status === 'success' ? 'success' : d.status === 'failed' ? 'failed' : 'skipped'
        }))
      })
      // Refresh the case list with newly imported cases
      caseListRef.value?.refreshCases()
    })
  }
})

onUnmounted(() => {
  cleanupImportComplete?.()
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
