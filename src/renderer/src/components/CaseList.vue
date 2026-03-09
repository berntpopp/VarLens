<template>
  <v-text-field
    v-model="search"
    prepend-inner-icon="mdi-magnify"
    placeholder="Search cases..."
    density="compact"
    hide-details
    clearable
    class="mx-2 mt-2"
  />

  <div class="case-filters-stack mx-2 mt-1">
    <v-select
      v-model="selectedCohortFilters"
      :items="cohortGroupsCache"
      item-title="name"
      item-value="id"
      prepend-inner-icon="mdi-account-group"
      label="Cohort"
      density="compact"
      hide-details
      clearable
      multiple
      chips
      closable-chips
      class="mb-1"
    />
    <v-autocomplete
      v-model="selectedHpoFilters"
      :items="availableHpoTerms"
      item-title="label"
      item-value="hpo_id"
      prepend-inner-icon="mdi-human"
      label="HPO"
      density="compact"
      hide-details
      clearable
      multiple
      chips
      closable-chips
      auto-select-first
    />
  </div>

  <v-list v-model:selected="selected" density="compact" select-strategy="single-leaf">
    <!-- Empty state -->
    <v-list-item v-if="filteredCases.length === 0 && !loading">
      <v-list-item-title class="text-grey text-center py-4">
        <template v-if="hasActiveFilters">
          <v-icon class="mb-1">mdi-filter-off</v-icon>
          <div>No matching cases</div>
        </template>
        <template v-else>
          <v-icon class="mb-1">mdi-folder-open-outline</v-icon>
          <div>No cases yet</div>
          <div class="text-body-small mt-1">Click + to import</div>
        </template>
      </v-list-item-title>
    </v-list-item>

    <!-- Case items -->
    <v-list-item
      v-for="caseItem in filteredCases"
      :key="caseItem.id"
      :value="caseItem.id"
      :class="{ 'multi-selected': isMultiSelected(caseItem.id) }"
      color="primary"
      @click="handleCaseClick($event, caseItem)"
      @contextmenu.prevent="handleContextMenu($event, caseItem)"
    >
      <template #prepend>
        <!-- Multi-select checkbox when in multi-select mode -->
        <v-icon
          v-if="isMultiSelectMode"
          :icon="
            isMultiSelected(caseItem.id) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'
          "
          :color="isMultiSelected(caseItem.id) ? 'primary' : 'grey'"
          size="small"
          class="mr-2"
        />
        <!-- Status + sex icons when not in multi-select mode -->
        <CaseStatusIcons
          v-else
          :status="getCaseStatusValue(caseItem.id)"
          :sex="getCaseSexValue(caseItem.id)"
          class="mr-2"
        />
      </template>

      <v-list-item-title>{{ caseItem.name }}</v-list-item-title>
      <v-list-item-subtitle>
        {{ caseItem.variant_count.toLocaleString() }} variants •
        <v-tooltip location="top">
          <template #activator="{ props: dateProps }">
            <span v-bind="dateProps">{{ formatDate(caseItem.created_at) }}</span>
          </template>
          {{ formatFullDate(caseItem.created_at) }}
        </v-tooltip>
      </v-list-item-subtitle>

      <!-- Cohort chips (show max 3, then +N more) -->
      <template #append>
        <div class="d-flex ga-1">
          <v-chip
            v-for="cohort in getCaseCohorts(caseItem.id).slice(0, 3)"
            :key="cohort.id"
            :color="getCohortColor(cohort.name)"
            size="x-small"
            label
          >
            {{ cohort.name }}
          </v-chip>
          <v-chip v-if="getCaseCohorts(caseItem.id).length > 3" size="x-small" color="grey" label>
            +{{ getCaseCohorts(caseItem.id).length - 3 }}
          </v-chip>
        </div>
      </template>
    </v-list-item>
  </v-list>

  <!-- Context menu -->
  <v-menu
    v-model="contextMenu.show.value"
    :style="{
      position: 'fixed',
      left: contextMenu.x.value + 'px',
      top: contextMenu.y.value + 'px'
    }"
    location-strategy="static"
  >
    <v-list density="compact">
      <!-- Edit single case -->
      <v-list-item @click="handleEdit">
        <template #prepend>
          <v-icon>mdi-pencil</v-icon>
        </template>
        <v-list-item-title>Edit</v-list-item-title>
      </v-list-item>
      <v-divider />
      <!-- Delete selected when multi-select active -->
      <v-list-item v-if="isMultiSelectMode" @click="handleDeleteSelected">
        <template #prepend>
          <v-icon color="error">mdi-delete</v-icon>
        </template>
        <v-list-item-title>Delete {{ multiSelectedCount }} Selected</v-list-item-title>
      </v-list-item>
      <!-- Single delete option -->
      <v-list-item @click="handleDelete">
        <template #prepend>
          <v-icon>mdi-delete</v-icon>
        </template>
        <v-list-item-title>Delete</v-list-item-title>
      </v-list-item>
      <!-- Clear selection when multi-select active -->
      <v-list-item v-if="isMultiSelectMode" @click="clearMultiSelect">
        <template #prepend>
          <v-icon>mdi-selection-off</v-icon>
        </template>
        <v-list-item-title>Clear Selection</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <DeleteCaseDialog ref="dialogRef" />
  <AppSnackbar ref="snackbarRef" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { Case, CohortGroup, AffectedStatus, CaseSex } from '../../../shared/types/api'
import { useContextMenu } from '../composables/useContextMenu'
import { useCaseMetadata, getCohortColor } from '../composables/useCaseMetadata'
import { useApiService } from '../composables/useApiService'
import CaseStatusIcons from './CaseStatusIcons.vue'
import DeleteCaseDialog from './DeleteCaseDialog.vue'
import AppSnackbar from './AppSnackbar.vue'

const emit = defineEmits<{
  'case-selected': [caseId: number, caseName: string, variantCount: number, createdAt: number]
  'case-deleted': [caseId: number]
  'cases-loaded': [count: number]
  'edit-case': [caseId: number, caseName: string, variantCount: number, createdAt: number]
}>()

// State
const cases = ref<Case[]>([])
const loading = ref(false)
const search = ref('')
const selectedCohortFilters = ref<number[]>([])
const selectedHpoFilters = ref<string[]>([])
const selected = ref<number[]>([])
const contextMenuCase = ref<Case | null>(null)
const contextMenu = useContextMenu()
const { api } = useApiService()

// Multi-select state
const multiSelected = ref<Set<number>>(new Set())
const isMultiSelectMode = computed(() => multiSelected.value.size > 0)
const multiSelectedCount = computed(() => multiSelected.value.size)
const isMultiSelected = (id: number): boolean => multiSelected.value.has(id)

// Initialize case metadata composable
const { loadMetadata, getMetadata, loadCohortGroups, cohortGroupsCache } = useCaseMetadata()

// Component refs
const dialogRef = ref<InstanceType<typeof DeleteCaseDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)

// Load cases from IPC
const loadCases = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  if (!api) {
    // eslint-disable-next-line no-undef
    console.warn('API not available - running outside Electron')
    return
  }

  loading.value = true
  try {
    cases.value = await api.cases.list()
    emit('cases-loaded', cases.value.length)

    // Load metadata for all cases
    await loadCohortGroups()
    await Promise.all(cases.value.map((c) => loadMetadata(c.id)))
  } finally {
    loading.value = false
  }
}

// Unique HPO terms across all loaded cases (for autocomplete suggestions)
const availableHpoTerms = computed(() => {
  const seen = new Map<string, string>()
  for (const c of cases.value) {
    const metadata = getMetadata(c.id)
    for (const t of metadata?.hpoTerms ?? []) {
      if (!seen.has(t.hpo_id)) {
        seen.set(t.hpo_id, t.hpo_label)
      }
    }
  }
  return Array.from(seen, ([hpo_id, hpo_label]) => ({
    hpo_id,
    label: `${hpo_label} (${hpo_id})`
  })).sort((a, b) => a.label.localeCompare(b.label))
})

// Whether any filter is active (for empty-state messaging)
const hasActiveFilters = computed(
  () =>
    !!search.value || selectedCohortFilters.value.length > 0 || selectedHpoFilters.value.length > 0
)

// Filter cases by search term, cohort(s), HPO(s) — sorted by created_at DESC
const filteredCases = computed(() => {
  let result = [...cases.value]

  if (search.value) {
    const query = search.value.toLowerCase()
    result = result.filter((c) => c.name.toLowerCase().includes(query))
  }

  if (selectedCohortFilters.value.length > 0) {
    const cohortIds = selectedCohortFilters.value
    result = result.filter((c) =>
      cohortIds.some((cohortId) => getCaseCohorts(c.id).some((cohort) => cohort.id === cohortId))
    )
  }

  if (selectedHpoFilters.value.length > 0) {
    const hpoIds = selectedHpoFilters.value
    result = result.filter((c) => {
      const metadata = getMetadata(c.id)
      const caseHpoIds = (metadata?.hpoTerms ?? []).map((t) => t.hpo_id)
      return hpoIds.some((hpoId) => caseHpoIds.includes(hpoId))
    })
  }

  // Sort by created_at descending (newest first)
  result.sort((a, b) => b.created_at - a.created_at)

  return result
})

// Format date as relative time ("2 days ago") with full date on hover
const formatDate = (timestamp: number): string => {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const weeks = Math.floor(days / 7)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  if (weeks < 4) return `${weeks}w ago`

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp))
}

const formatFullDate = (timestamp: number): string => {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(timestamp))
}

// Watch selection changes and emit
watch(selected, (newSelection) => {
  if (newSelection.length > 0) {
    const selectedCase = cases.value.find((c) => c.id === newSelection[0])
    emit(
      'case-selected',
      newSelection[0],
      selectedCase?.name ?? '',
      selectedCase?.variant_count ?? 0,
      selectedCase?.created_at ?? 0
    )
  }
})

// Click handler for Ctrl+click multi-select
const handleCaseClick = (event: MouseEvent | KeyboardEvent, caseItem: Case): void => {
  if (event.ctrlKey || event.metaKey) {
    // Toggle multi-select
    event.preventDefault()
    event.stopPropagation()
    const newSet = new Set(multiSelected.value)
    if (newSet.has(caseItem.id)) {
      newSet.delete(caseItem.id)
    } else {
      newSet.add(caseItem.id)
    }
    multiSelected.value = newSet
  } else {
    // Clear multi-select on regular click
    if (multiSelected.value.size > 0) {
      multiSelected.value = new Set()
    }
    // Let v-list handle single selection via v-model:selected
  }
}

// Clear multi-select helper
const clearMultiSelect = (): void => {
  contextMenu.close()
  multiSelected.value = new Set()
}

// Context menu handlers
const handleContextMenu = (event: MouseEvent, caseItem: Case): void => {
  contextMenuCase.value = caseItem
  contextMenu.open(event)
}

const handleEdit = (): void => {
  contextMenu.close()
  if (contextMenuCase.value == null) return
  const c = contextMenuCase.value
  emit('edit-case', c.id, c.name, c.variant_count, c.created_at)
}

const handleDelete = async (): Promise<void> => {
  contextMenu.close()

  if (contextMenuCase.value === null || contextMenuCase.value === undefined) return

  const caseToDelete = contextMenuCase.value
  const confirmed = await dialogRef.value?.show(caseToDelete.name, caseToDelete.variant_count)

  if (confirmed === true) {
    await api!.cases.delete(caseToDelete.id)
    emit('case-deleted', caseToDelete.id)

    // If deleted case was selected, clear selection
    if (selected.value.includes(caseToDelete.id) === true) {
      selected.value = []
    }

    // Remove from multi-select if present
    if (multiSelected.value.has(caseToDelete.id)) {
      const newSet = new Set(multiSelected.value)
      newSet.delete(caseToDelete.id)
      multiSelected.value = newSet
    }

    snackbarRef.value?.show(`Deleted "${caseToDelete.name}"`)
    await loadCases()
  }
}

const handleDeleteSelected = async (): Promise<void> => {
  contextMenu.close()

  const ids = Array.from(multiSelected.value)
  if (ids.length === 0) return

  // Calculate total variant count for confirmation
  const totalVariants = ids.reduce((sum, id) => {
    const caseItem = cases.value.find((c) => c.id === id)
    return sum + (caseItem?.variant_count ?? 0)
  }, 0)

  const confirmed = await dialogRef.value?.showBatch(ids.length, totalVariants)

  if (confirmed === true) {
    const deleted = await api!.cases.deleteBatch(ids)

    // Emit deleted event for each case
    for (const id of ids) {
      emit('case-deleted', id)
    }

    // Clear single selection if it was deleted
    if (selected.value.length > 0 && ids.includes(selected.value[0])) {
      selected.value = []
    }

    // Clear multi-select
    multiSelected.value = new Set()

    snackbarRef.value?.show(`Deleted ${deleted} ${deleted === 1 ? 'case' : 'cases'}`)
    await loadCases()
  }
}

// Helper functions for metadata display
function getCaseStatusValue(caseId: number): AffectedStatus {
  const metadata = getMetadata(caseId)
  return metadata?.metadata?.affected_status ?? 'unknown'
}

function getCaseSexValue(caseId: number): CaseSex {
  const metadata = getMetadata(caseId)
  return metadata?.metadata?.sex ?? 'unknown'
}

function getCaseCohorts(caseId: number): CohortGroup[] {
  const metadata = getMetadata(caseId)
  return metadata?.cohorts ?? []
}

// Expose methods for parent to call after import
const refreshCases = async (): Promise<void> => {
  await loadCases()
}

const selectCase = (caseId: number): void => {
  selected.value = [caseId]
}

defineExpose({ refreshCases, selectCase })

onMounted(loadCases)
</script>

<style scoped>
.multi-selected {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent) !important;
}

:deep(.v-list-item--active) {
  border-left: 4px solid rgb(var(--v-theme-primary));
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent) !important;
}

:deep(.v-list-item--active .v-list-item__prepend) {
  padding-left: calc(16px - 4px);
}
</style>
