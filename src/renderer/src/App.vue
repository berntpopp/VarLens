<template>
  <v-app>
    <v-app-bar color="primary" density="compact" flat>
      <v-app-bar-nav-icon
        aria-label="Toggle navigation sidebar"
        @click="sidebarOpen = !sidebarOpen"
      />
      <v-icon icon="custom:varlens-dna" class="ml-2" size="small" />
      <v-app-bar-title class="ml-2 text-subtitle-1 font-weight-bold"> VarLens </v-app-bar-title>
    </v-app-bar>

    <v-navigation-drawer v-model="sidebarOpen" :width="280">
      <AppSidebar @import-click="handleImportClick">
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
    <AppSnackbar ref="snackbarRef" />
    <LogViewer v-model:open="logViewerOpen" />
    <DisclaimerDialog ref="disclaimerRef" @acknowledged="handleDisclaimerAcknowledged" />
    <FaqDialog ref="faqDialogRef" />
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
import AppSnackbar from './components/AppSnackbar.vue'
import LogViewer from './components/LogViewer.vue'
import AppFooter from './components/AppFooter.vue'
import DisclaimerDialog from './components/DisclaimerDialog.vue'
import FaqDialog from './components/FaqDialog.vue'
import { useKeyboardShortcuts } from './composables/useKeyboardShortcuts'
import { useVersionGating } from './composables/useVersionGating'
import { logService } from './services/LogService'
import type { VariantFilter } from '../../shared/types/api'

// Component refs
const importDialogRef = ref<InstanceType<typeof ImportDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)
const caseListRef = ref<InstanceType<typeof CaseList> | null>(null)
const variantTableRef = ref<InstanceType<typeof VariantTable> | null>(null)
const disclaimerRef = ref<InstanceType<typeof DisclaimerDialog> | null>(null)
const faqDialogRef = ref<InstanceType<typeof FaqDialog> | null>(null)

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

// Check initial disclaimer acknowledgment state
const { needsAcknowledgment } = useVersionGating()
disclaimerAcknowledged.value = !needsAcknowledgment()

// Lifecycle
onMounted(() => {
  // Check disclaimer acknowledgment on startup
  disclaimerRef.value?.checkAndShow()
})
</script>
