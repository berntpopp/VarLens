<template>
  <v-app-bar color="primary" density="compact" flat>
    <v-btn
      :icon="sidebarOpen ? mdiChevronDoubleLeft : mdiChevronDoubleRight"
      variant="text"
      size="small"
      :aria-label="sidebarOpen ? 'Close sidebar' : 'Open sidebar'"
      :aria-expanded="sidebarOpen"
      class="sidebar-toggle-btn"
      data-testid="app-sidebar-toggle"
      @click="handleSidebarToggle"
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
          on-toolbar
          class="mr-1"
        />
        <span
          class="text-body-medium font-weight-medium text-truncate context-label clickable-case-name"
          role="button"
          tabindex="0"
          @click="$emit('show-case-metadata')"
          @keydown.enter="$emit('show-case-metadata')"
        >
          {{ selectedCaseName }}
        </span>
        <IconButton
          label="Case details"
          :icon="mdiInformationOutline"
          size="small"
          class="ml-1"
          @click="$emit('show-case-metadata')"
        />
      </template>
      <template v-else-if="activeTab === 'cohort'">
        <v-icon size="small" class="mr-1" :icon="mdiAccountGroup" />
        <span class="text-body-medium font-weight-medium">
          Cohort ({{ caseCount }} {{ caseCount === 1 ? 'case' : 'cases' }})
        </span>
      </template>
      <template v-else>
        <v-icon size="small" class="mr-1" :icon="mdiAccount" style="opacity: 0.7" />
        <!-- No opacity on the text: 0.7 dropped it to 4.34:1 on the dark-theme app bar -->
        <span
          class="text-body-medium select-case-hint"
          role="button"
          tabindex="0"
          @click="openSidebar"
          @keydown.enter="openSidebar"
        >
          Select a case...
        </span>
      </template>
    </div>

    <ImportStatusChip @click="$emit('show-import-progress')" />
    <v-chip
      v-if="role === 'viewer'"
      size="small"
      variant="outlined"
      class="ml-2"
      :prepend-icon="mdiEyeOutline"
      :title="writeBlockedReason ?? undefined"
      data-testid="read-only-chip"
    >
      Read-only
    </v-chip>

    <v-spacer />

    <v-btn-toggle
      v-model="activeTabModel"
      mandatory
      density="compact"
      variant="outlined"
      divided
      selected-class="mode-toggle--active"
      class="mode-toggle mr-2"
    >
      <v-btn value="case" size="small" aria-label="Case mode">
        <v-icon :start="showModeToggleLabels" size="small" :icon="mdiAccount" />
        <span v-if="showModeToggleLabels">Case</span>
      </v-btn>
      <v-btn value="cohort" size="small" aria-label="Cohort mode">
        <v-icon :start="showModeToggleLabels" size="small" :icon="mdiAccountGroup" />
        <span v-if="showModeToggleLabels">Cohort</span>
      </v-btn>
    </v-btn-toggle>

    <DatabasePicker
      @database-switched="$emit('database-switched')"
      @error="$emit('database-error', $event)"
    />
    <v-menu>
      <template #activator="{ props }">
        <IconButton
          v-bind="props"
          label="Application settings"
          tooltip="Settings"
          :icon="mdiCog"
          data-testid="app-settings-menu"
        />
      </template>
      <v-list density="compact">
        <v-list-subheader>Data</v-list-subheader>
        <v-list-item
          :prepend-icon="mdiChartBoxOutline"
          title="Database Overview"
          @click="$emit('show-database-overview')"
        />
        <!-- Role-blocked actions are hidden (viewers see the Read-only chip). -->
        <v-list-item
          v-if="canWrite"
          :prepend-icon="mdiDatabaseImport"
          title="Import Data"
          :subtitle="importShortcut"
          @click="$emit('import-click')"
        />
        <v-list-item
          v-if="multiFileImportAvailable && canWrite"
          :prepend-icon="mdiFileDocumentMultiple"
          title="Import VCF Files"
          subtitle="Multi-file case (SNV + SV + CNV + STR)"
          @click="$emit('vcf-import-click')"
        />
        <v-divider class="my-1" role="none" />
        <v-list-subheader>Settings</v-list-subheader>
        <v-list-item
          :prepend-icon="mdiLink"
          title="External Links"
          @click="$emit('show-external-links')"
        />
        <v-list-item
          v-if="canWrite"
          :prepend-icon="mdiTagMultiple"
          title="Custom Tags"
          @click="$emit('show-tag-management')"
        />
        <v-list-item
          :prepend-icon="mdiPlaylistEdit"
          title="Gene Panels"
          @click="$emit('show-panel-manager')"
        />
        <v-list-item
          :prepend-icon="mdiTune"
          title="Application Preferences"
          @click="$emit('show-preferences')"
        />
        <v-divider class="my-1" role="none" />
        <v-list-subheader>Reset Preferences</v-list-subheader>
        <v-list-item
          :prepend-icon="mdiTableColumn"
          title="Reset Columns"
          subtitle="Restore default column visibility and order"
          @click="$emit('reset-columns')"
        />
        <v-list-item
          :prepend-icon="mdiFilterOff"
          title="Reset Filters"
          subtitle="Restore default filter group arrangement"
          @click="$emit('reset-filters')"
        />
        <template v-if="canAdmin">
          <v-divider class="my-1" role="none" />
          <v-list-subheader class="danger-zone-subheader">Danger Zone</v-list-subheader>
        </template>
        <v-list-item
          v-if="canAdmin"
          :disabled="deleteAllReason !== null"
          :aria-disabled="deleteAllReason !== null ? 'true' : undefined"
          @click="$emit('delete-all-cases')"
        >
          <template #prepend>
            <v-icon color="error" :icon="mdiDeleteSweep" />
          </template>
          <v-list-item-title>Delete All Cases</v-list-item-title>
          <v-list-item-subtitle>
            {{ deleteAllReason ?? 'Remove all cases from database' }}
          </v-list-item-subtitle>
        </v-list-item>
      </v-list>
    </v-menu>
    <AccountMenu />
  </v-app-bar>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import DatabasePicker from './DatabasePicker.vue'
import CaseStatusIcons from './CaseStatusIcons.vue'
import ImportStatusChip from './ImportStatusChip.vue'
import AccountMenu from './account/AccountMenu.vue'
import IconButton from './common/IconButton.vue'
import { useAppState } from '../composables/useAppState'
import { useResponsiveLayout } from '../composables/useResponsiveLayout'
import { useCaseMetadata } from '../composables/useCaseMetadata'
import { useCapabilityStore } from '../stores/capabilityStore'
import { getCurrentUnsupportedReasonSync } from '../utils/backend-capabilities'
import { usePermissions } from '../composables/usePermissions'
import type { AffectedStatus, CaseSex } from '../../../shared/types/api'
import {
  mdiAccount,
  mdiAccountGroup,
  mdiChartBoxOutline,
  mdiChevronDoubleLeft,
  mdiChevronDoubleRight,
  mdiCog,
  mdiDatabaseImport,
  mdiDeleteSweep,
  mdiEyeOutline,
  mdiFileDocumentMultiple,
  mdiFilterOff,
  mdiInformationOutline,
  mdiLink,
  mdiTableColumn,
  mdiPlaylistEdit,
  mdiTagMultiple,
  mdiTune
} from '@mdi/js'

const {
  selectedCaseId,
  selectedCaseName,
  caseCount,
  activeTab,
  sidebarOpen,
  setActiveTab,
  openSidebar,
  closeSidebar,
  returnToCaseHome
} = useAppState()

const { showModeToggleLabels, showContextIndicator } = useResponsiveLayout()
const { getMetadata, loadMetadata } = useCaseMetadata()
const multiFileImportAvailable = useCapabilityStore().canUse('multiFileImport')
const importShortcut = /mac/i.test(navigator.platform ?? '') ? 'Option+Shift+O' : 'Alt+Shift+O'
const { role, canWrite, canAdmin, writeBlockedReason, adminBlockedReason } = usePermissions()
// Role- and capability-gated: disabled with the reason instead of failing after a click.
const deleteAllReason = computed(
  () => adminBlockedReason.value ?? getCurrentUnsupportedReasonSync('cases.deleteAll')
)

// Preload metadata when a case is selected so status/sex icons display immediately
watch(
  selectedCaseId,
  (caseId) => {
    if (caseId != null) {
      loadMetadata(caseId)
    }
  },
  { immediate: true }
)

defineEmits<{
  'show-case-metadata': []
  'show-database-overview': []
  'show-external-links': []
  'show-tag-management': []
  'show-panel-manager': []
  'show-preferences': []
  'show-import-progress': []
  'import-click': []
  'vcf-import-click': []
  'reset-columns': []
  'reset-filters': []
  'delete-all-cases': []
  'database-switched': []
  'database-error': [message: string]
}>()

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

const activeTabModel = computed<'case' | 'cohort'>({
  get: () => activeTab.value,
  set: (tab) => setActiveTab(tab)
})

const handleSidebarToggle = (): void => {
  if (sidebarOpen.value) {
    closeSidebar()
  } else {
    openSidebar()
  }
}

const handleHomeClick = (): void => {
  returnToCaseHome()
}
</script>

<style scoped>
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

.mode-toggle :deep(.v-btn--active),
.mode-toggle :deep(.mode-toggle--active) {
  /* Inverted pill: on-primary background, primary text (11.5:1 light, 7.8:1 dark) */
  background-color: rgb(var(--v-theme-on-primary)) !important;
  color: rgb(var(--v-theme-primary)) !important;
  font-weight: 600;
}

.mode-toggle :deep(.v-btn:not(.v-btn--active)) {
  color: rgb(var(--v-theme-on-primary)) !important;
}

.sidebar-toggle-btn :deep(.v-icon) {
  transition: transform 0.2s ease-in-out;
}
</style>
