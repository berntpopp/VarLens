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
      <AppSidebar
        :case-count="caseCount"
        @import-click="dialogHostRef?.showImportDialog()"
        @vcf-import-click="dialogHostRef?.showVcfImportDialog()"
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
      @batch-import-complete="handleDialogBatchImportComplete"
      @metadata-changed="handleMetadataChanged"
    />

    <KeyboardShortcutsDialog v-model="showKeyboardHelp" />

    <ViewTransitionOverlay :model-value="transitioning" />
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, provide, defineAsyncComponent, toRef } from 'vue'
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
import { useShellNavigation } from './composables/useShellNavigation'
import { useShellLifecycle } from './composables/useShellLifecycle'
import { useApiService } from './composables/useApiService'
import { useImportStatusStore } from './stores/importStatusStore'
import { isWebRuntime } from './utils/runtime-mode'
import { useVariantColumnMeta } from './composables/useVariantColumnMeta'
import {
  resetRendererLongTaskObserver,
  startRendererLongTaskObserver,
  stopRendererLongTaskObserver
} from './services/RendererLongTaskObserver'
import { resetRendererPerfSnapshot } from './services/PerfSnapshot'
import { getTraceSnapshot } from './services/PerfTrace'
import { unwrapIpcResult } from '../../shared/types/errors'
import { getCurrentUnsupportedReason } from './utils/backend-capabilities'

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
const variantColumnMeta = useVariantColumnMeta()

// Create and provide shared app state for child components
const appState = createAppState()
provide(AppStateKey, appState)

const {
  selectedCaseId,
  caseCount,
  activeTab,
  sidebarOpen,
  panelOpen,
  selectedPanelVariant,
  panelMode,
  variantTableRef,
  filterToolbarRef,
  setCaseCount,
  incrementDataGeneration,
  closeSidebar,
  clearSelectedCase,
  resetCaseFilters,
  resetCaseContext,
  resetForDatabaseSwitch,
  selectCase
} = appState

// Keyboard shortcuts help dialog
const showKeyboardHelp = ref(false)

// View transition overlay
const transitioning = ref(false)

// Responsive layout
const { tier } = useResponsiveLayout()

// Database store
const databaseStore = useDatabaseStore()
const databasePath = toRef(databaseStore, 'currentPath')

// Case metadata
const { clearCache: clearMetadataCache } = useCaseMetadata()

// Preference resets
const { resetToDefaults: resetVariantColumns } = useColumnPreferences('variant-table')
const { resetToDefaults: resetCohortColumns } = useColumnPreferences('cohort-table')
const { resetToDefaults: resetFilterPreferences } = useFilterPreferences()

// Component refs
const dialogHostRef = ref<InstanceType<typeof AppDialogHostType> | null>(null)
const caseListRef = ref<InstanceType<typeof CaseList> | null>(null)
const databaseName = toRef(databaseStore, 'currentName')

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
    closeSidebar()
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
  const reason = await getCurrentUnsupportedReason('cases.deleteAll')
  if (reason !== null) {
    logService.warn(reason, 'backend-capabilities')
    dialogHostRef.value?.showSnackbar(reason, 'error')
    return
  }
  const confirmed = await dialogHostRef.value?.showDeleteAllCases(caseCount.value)
  if (confirmed === true) {
    const deleted = unwrapIpcResult(await api.cases.deleteAll())
    resetCaseContext()
    incrementDataGeneration()
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
  selectCase({ caseId, caseName, variantCount, createdAt })
  closeSidebar()
}

const handleEditCase = (
  caseId: number,
  caseName: string,
  variantCount: number,
  createdAt: number
): void => {
  selectCase({ caseId, caseName, variantCount, createdAt })
  dialogHostRef.value?.showCaseMetadata()
}

const handleCasesLoaded = (count: number): void => {
  setCaseCount(count)
}
const handleCaseDeleted = (caseId: number): void => {
  if (selectedCaseId.value === caseId) clearSelectedCase()
  if (isWebRuntime()) variantColumnMeta.invalidateAll()
  incrementDataGeneration()
}

useShellNavigation({
  activeTab,
  sidebarOpen,
  panelOpen,
  selectedPanelVariant,
  transitioning,
  router
})

// Clear filters on case change
watch(selectedCaseId, () => {
  resetCaseFilters()
})

const { handleDatabaseSwitched, handleImportComplete, handleBatchImportComplete } =
  useShellLifecycle({
    api,
    currentDatabasePath: databasePath,
    currentDatabaseName: databaseName,
    incrementDataGeneration,
    resetForDatabaseSwitch,
    clearMetadataCache,
    selectCase,
    caseListRef,
    dialogHostRef: dialogHostRef as Parameters<typeof useShellLifecycle>[0]['dialogHostRef'],
    importStore
  })

const handleDialogBatchImportComplete = async (): Promise<void> => {
  if (!isWebRuntime()) return
  await handleBatchImportComplete()
}

const handleMetadataChanged = async (): Promise<void> => {
  if (!isWebRuntime()) return
  incrementDataGeneration()
  await caseListRef.value?.refreshCases()
}

const handleShowImportProgress = (): void => {
  dialogHostRef.value?.reopenImportDialog()
  dialogHostRef.value?.reopenBatchImportDialog()
  void dialogHostRef.value?.reopenVcfImportDialog()
}

const handleCancelImport = async (): Promise<void> => {
  if (api != null) unwrapIpcResult(await api.import.cancel())
  if (api?.batchImport != null) {
    unwrapIpcResult(await api.batchImport.cancel())
  }
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

const perfModeEnabled = api?.perf?.isEnabled?.() === true

type RendererPerfRequestEvent = CustomEvent<{ id: string; action: 'get' | 'reset' }>

const handlePerfRequest = async (event: Event): Promise<void> => {
  const perfEvent = event as RendererPerfRequestEvent
  const { id, action } = perfEvent.detail

  if (action === 'reset') {
    resetRendererPerfSnapshot()
    resetRendererLongTaskObserver()
    window.dispatchEvent(
      new CustomEvent('varlens:perf-response', {
        detail: { id, payload: undefined }
      })
    )
    return
  }

  window.dispatchEvent(
    new CustomEvent('varlens:perf-response', {
      detail: {
        id,
        payload: getTraceSnapshot()
      }
    })
  )
}

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
  if (import.meta.env.DEV || perfModeEnabled) {
    api?.perf?.reportInteractive()
  }

  if (perfModeEnabled) {
    startRendererLongTaskObserver()
    window.addEventListener('varlens:perf-request', handlePerfRequest as EventListener)
  }
})

onUnmounted(() => {
  if (perfModeEnabled) {
    window.removeEventListener('varlens:perf-request', handlePerfRequest as EventListener)
    stopRendererLongTaskObserver()
  }
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
