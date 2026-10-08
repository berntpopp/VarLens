<template>
  <!-- During a Case/Cohort switch the sidebar collapses in the same tick the
       new view mounts; animating v-main's padding there shifted the incoming
       view sideways (CLS ~0.3). Collapse instantly instead. -->
  <v-app
    :class="{
      'shell--instant-layout': transitioning,
      'shell--instant-main': dockedPanelInstantLayout
    }"
  >
    <A11yShell />
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

    <v-navigation-drawer
      v-model="sidebarOpen"
      aria-label="Cases sidebar"
      :width="sidebarWidth"
      mobile-breakpoint="md"
      :scrim="tier === 'narrow'"
    >
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
          @cases-load-failed="markCasesLoadFailed"
          @edit-case="handleEditCase"
        />
      </AppSidebar>
      <div
        class="sidebar-resize-handle"
        @mousedown="startSidebarResize"
        @dblclick="resetSidebarWidth"
      />
    </v-navigation-drawer>

    <v-main id="main-content" tabindex="-1">
      <h1 class="visually-hidden" data-testid="view-heading">{{ viewTitle.heading }}</h1>
      <ChunkLoadErrorBanner />
      <router-view v-slot="{ Component }">
        <keep-alive :max="2">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </v-main>

    <ImportStatusBar @expand="handleShowImportProgress" @cancel="handleCancelImport" />

    <VariantDetailsPanel
      v-if="detailsPanelMounted"
      v-model:open="panelOpen"
      :variant="selectedPanelVariant"
      :case-id="activeTab === 'case' ? selectedCaseId : null"
      :mode="panelMode"
      @variant-updated="variantTableRef?.refresh()"
    />

    <AppFooter
      :disclaimer-acknowledged="dialogHostRef?.disclaimerAcknowledged ?? false"
      :log-viewer-open="dialogHostRef?.logViewerOpen ?? false"
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

    <!-- Progress + cancel for exports, deletes and imports in every view.
         Collapsed by default; AppFooter's BackgroundJobsToggle opens it. -->
    <BackgroundJobsPanel />

    <KeyboardShortcutsDialog v-if="keyboardHelpMounted" v-model="showKeyboardHelp" />

    <ViewTransitionOverlay v-if="transitionOverlayMounted" :model-value="transitioning" />
  </v-app>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, provide, defineAsyncComponent, toRef } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import AppToolbar from './components/AppToolbar.vue'
import AppSidebar from './components/AppSidebar.vue'
import CaseList from './components/CaseList.vue'
import A11yShell from './components/common/A11yShell.vue'
import ChunkLoadErrorBanner from './components/common/ChunkLoadErrorBanner.vue'
import { useViewTitle } from './composables/useViewTitle'
import { useThemePreference } from './composables/useThemePreference'
import { installUrlStateSync } from './composables/useUrlState'
import { useCaseUrlParam } from './composables/useViewUrlBindings'
import AppFooter from './components/AppFooter.vue'
import BackgroundJobsPanel from './components/jobs/BackgroundJobsPanel.vue'
import type AppDialogHostType from './components/AppDialogHost.vue'
import { usePanelResize } from './composables/usePanelResize'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useDatabaseStore } from './stores/databaseStore'
import { useCaseMetadata } from './composables/useCaseMetadata'
import { useCaseDeletion } from './composables/useCaseDeletion'
import { useColumnPreferences } from './composables/useColumnPreferences'
import { useFilterPreferences } from './composables/useFilterPreferences'
import { useResponsiveLayout } from './composables/useResponsiveLayout'
import { useMountOnFirstOpen } from './composables/useMountOnFirstOpen'
import { useDockedPanelInstantLayout } from './composables/useDockedPanelInstantLayout'
import { logService } from './services/LogService'
import { AppStateKey, createAppState } from './composables/useAppState'
import { useShellNavigation } from './composables/useShellNavigation'
import { useShellLifecycle } from './composables/useShellLifecycle'
import { useApiService } from './composables/useApiService'
import { useImportStatusStore } from './stores/importStatusStore'
import { isWebRuntime } from './utils/runtime-mode'
import {
  resetRendererLongTaskObserver,
  startRendererLongTaskObserver,
  stopRendererLongTaskObserver
} from './services/RendererLongTaskObserver'
import { resetRendererPerfSnapshot } from './services/PerfSnapshot'
import { getTraceSnapshot } from './services/PerfTrace'
import { unwrapIpcResult } from '../../shared/types/errors'
import { formatError } from './utils/ipc-result'
import { getCurrentUnsupportedReason } from './utils/backend-capabilities'
import { usePermissions } from './composables/usePermissions'

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
const permissions = usePermissions()
const importStore = useImportStatusStore()

// Create and provide shared app state for child components
const appState = createAppState()
provide(AppStateKey, appState)
const viewTitle = useViewTitle(appState)
useThemePreference()
installUrlStateSync(router)
useCaseUrlParam(appState)

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
  markCasesLoadFailed,
  incrementDataGeneration,
  closeSidebar,
  clearSelectedCase,
  resetCaseFilters,
  resetCaseContext,
  resetForDatabaseSwitch,
  closePanelWithoutAsking,
  selectCase
} = appState

// Keyboard shortcuts help dialog
const showKeyboardHelp = ref(false)

// View transition overlay
const transitioning = ref(false)

// Responsive layout
const { tier, detailPanelDocked } = useResponsiveLayout()
// The docked details panel resizes v-main/footer in one frame (no animated reflow).
const dockedPanelInstantLayout = useDockedPanelInstantLayout(panelOpen, detailPanelDocked)
// Same signal the sidebar's `mobile-breakpoint="md"` uses to switch to a
// temporary overlay (below 840 px; Vuetify's default would be `lg`, 1145 px).
const { smAndDown: sidebarIsOverlay } = useDisplay()

// Heavy overlays mount on first open only: rendering an async component with
// v-model=false still downloads its chunk (and runs its fetch watchers) on
// first paint, which taxed every cold Home load.
const detailsPanelMounted = useMountOnFirstOpen(() => panelOpen.value)
const keyboardHelpMounted = useMountOnFirstOpen(() => showKeyboardHelp.value)
const transitionOverlayMounted = useMountOnFirstOpen(() => transitioning.value)

// Database store
const databaseStore = useDatabaseStore()
const databasePath = toRef(databaseStore, 'currentPath')

// Case metadata
const { clearCache: clearMetadataCache } = useCaseMetadata()
const { deleteAllCases } = useCaseDeletion()

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
  const reason =
    permissions.adminBlockedReason.value ?? (await getCurrentUnsupportedReason('cases.deleteAll'))
  if (reason !== null) {
    logService.warn(reason, 'backend-capabilities')
    dialogHostRef.value?.showSnackbar(reason, 'error')
    return
  }
  const confirmed = await dialogHostRef.value?.showDeleteAllCases(caseCount.value)
  if (confirmed === true) {
    // Progress and cancel are shown by the background-jobs panel meanwhile.
    try {
      const deleted = await deleteAllCases()
      dialogHostRef.value?.showSnackbar(
        `Deleted ${deleted} ${deleted === 1 ? 'case' : 'cases'}`,
        'success'
      )
    } catch (error) {
      dialogHostRef.value?.showSnackbar(formatError(error, 'Deleting all cases failed.'), 'error')
    } finally {
      // Every case is gone: there is nothing left to apply a draft to.
      closePanelWithoutAsking()
      resetCaseContext()
      incrementDataGeneration()
      await caseListRef.value?.refreshCases()
    }
  }
}

// Case list handlers
let restoredCaseId: number | null = null
const handleCaseSelected = async (
  caseId: number,
  caseName: string,
  variantCount: number,
  createdAt: number
): Promise<void> => {
  // The list re-emits the case its highlight was put back on: nothing to open.
  if (caseId === restoredCaseId) {
    restoredCaseId = null
    return
  }
  const leave = appState.confirmPanelLeave() // null without a draft: no tick lost
  if (leave !== null && !(await leave)) {
    // Cancel: the list already highlights the case that was not opened.
    restoredCaseId = selectedCaseId.value
    caseListRef.value?.selectCase(selectedCaseId.value)
    return
  }
  selectCase({ caseId, caseName, variantCount, createdAt })
  // Docked (desktop) sidebar stays put: collapsing it animated the whole
  // case view sideways right after open (CLS ~0.19). Only dismiss it when it
  // is a temporary overlay covering the content (narrow/mobile widths).
  if (sidebarIsOverlay.value) closeSidebar()
}

const handleEditCase = async (
  caseId: number,
  caseName: string,
  variantCount: number,
  createdAt: number
): Promise<void> => {
  // The editor reads the selected case at once: open it only after the draft prompt.
  const leave = appState.confirmPanelLeave()
  if (leave !== null && !(await leave)) return
  selectCase({ caseId, caseName, variantCount, createdAt })
  dialogHostRef.value?.showCaseMetadata()
}

const handleCasesLoaded = (count: number): void => {
  setCaseCount(count)
}
const handleCaseDeleted = (caseId: number): void => {
  if (selectedCaseId.value === caseId) {
    // No prompt: Apply would write into the case being deleted, Cancel would keep it selected.
    closePanelWithoutAsking()
    clearSelectedCase()
  }
  incrementDataGeneration()
}

useShellNavigation({
  activeTab,
  sidebarOpen,
  panelOpen,
  selectedPanelVariant,
  transitioning,
  router,
  confirmPanelLeave: appState.confirmPanelLeave,
  closePanelWithoutAsking
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

appState.setCaseMetadataHandler(() => {
  dialogHostRef.value?.showCaseMetadata()
})

/** Open the import wizard. Viewers are read-only, so for them it does nothing. */
function openImportDialog(): void {
  if (permissions.canWrite.value) dialogHostRef.value?.showImportDialog()
}
appState.setImportHandler(openImportDialog)

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
  // Viewers are read-only: the shortcut does nothing (the menu item is disabled).
  onImport: openImportDialog
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
    logService.error('Failed to fetch database info: ' + formatError(error), 'app')
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
.shell--instant-layout :deep(.v-main),
.shell--instant-layout :deep(.v-navigation-drawer) {
  transition: none !important;
}

/* Docked details panel: shrink the main area in a single frame. Animating its
   padding slid every right-aligned control (pagination, toolbar) across ~12
   frames of layout shift. The panel itself keeps its transform slide-in, and
   the app footer spans beneath it (layout `order`), so the footer never moves. */
.shell--instant-main :deep(.v-main) {
  transition: none !important;
}

:deep(.v-main) {
  --v-layout-top: 0px !important;
  padding-top: var(--app-bar-height, 48px) !important;
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
