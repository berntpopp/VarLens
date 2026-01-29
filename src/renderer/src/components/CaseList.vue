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

  <v-list v-model:selected="selected" density="compact" select-strategy="single-leaf">
    <!-- Empty state -->
    <v-list-item v-if="filteredCases.length === 0 && !loading">
      <v-list-item-title class="text-grey text-center py-4">
        <template v-if="search">
          <v-icon class="mb-1">mdi-magnify</v-icon>
          <div>No matching cases</div>
        </template>
        <template v-else>
          <v-icon class="mb-1">mdi-folder-open-outline</v-icon>
          <div>No cases yet</div>
          <div class="text-caption mt-1">Click + to import</div>
        </template>
      </v-list-item-title>
    </v-list-item>

    <!-- Case items -->
    <v-list-item
      v-for="caseItem in filteredCases"
      :key="caseItem.id"
      :value="caseItem.id"
      color="primary"
      @contextmenu.prevent="handleContextMenu($event, caseItem)"
    >
      <template #prepend>
        <!-- Status icon -->
        <v-icon
          :icon="getCaseStatusIcon(caseItem.id)"
          :color="getCaseStatusColor(caseItem.id)"
          size="small"
          class="mr-2"
        />
      </template>

      <v-list-item-title>{{ caseItem.name }}</v-list-item-title>
      <v-list-item-subtitle>
        {{ caseItem.variant_count.toLocaleString() }} variants •
        {{ formatDate(caseItem.created_at) }}
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
      <v-list-item @click="handleDelete">
        <template #prepend>
          <v-icon>mdi-delete</v-icon>
        </template>
        <v-list-item-title>Delete</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <DeleteCaseDialog ref="dialogRef" />
  <AppSnackbar ref="snackbarRef" />
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { Case, CohortGroup } from '../../../shared/types/api'
import { useContextMenu } from '../composables/useContextMenu'
import {
  useCaseMetadata,
  STATUS_ICONS,
  STATUS_COLORS,
  getCohortColor
} from '../composables/useCaseMetadata'
import DeleteCaseDialog from './DeleteCaseDialog.vue'
import AppSnackbar from './AppSnackbar.vue'

const emit = defineEmits<{
  'case-selected': [caseId: number, caseName: string]
  'case-deleted': [caseId: number]
  'cases-loaded': [count: number]
}>()

// State
const cases = ref<Case[]>([])
const loading = ref(false)
const search = ref('')
const selected = ref<number[]>([])
const contextMenuCase = ref<Case | null>(null)
const contextMenu = useContextMenu()

// Initialize case metadata composable
const { loadMetadata, getMetadata, loadCohortGroups } = useCaseMetadata()

// Component refs
const dialogRef = ref<InstanceType<typeof DeleteCaseDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)

// Load cases from IPC
const loadCases = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
    return
  }

  loading.value = true
  try {
    // eslint-disable-next-line no-undef
    cases.value = await window.api.cases.list()
    emit('cases-loaded', cases.value.length)

    // Load metadata for all cases
    await loadCohortGroups()
    await Promise.all(cases.value.map((c) => loadMetadata(c.id)))
  } finally {
    loading.value = false
  }
}

// Filter cases by search term, sorted by created_at DESC
const filteredCases = computed(() => {
  let result = [...cases.value]

  if (search.value !== undefined && search.value !== '') {
    const query = search.value.toLowerCase()
    result = result.filter((c) => c.name.toLowerCase().includes(query))
  }

  // Sort by created_at descending (newest first)
  result.sort((a, b) => b.created_at - a.created_at)

  return result
})

// Format date as "Jan 26" style
const formatDate = (timestamp: number): string => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(new Date(timestamp))
}

// Watch selection changes and emit
watch(selected, (newSelection) => {
  if (newSelection.length > 0) {
    const selectedCase = cases.value.find((c) => c.id === newSelection[0])
    emit('case-selected', newSelection[0], selectedCase?.name ?? '')
  }
})

// Context menu handlers
const handleContextMenu = (event: MouseEvent, caseItem: Case): void => {
  contextMenuCase.value = caseItem
  contextMenu.open(event)
}

const handleDelete = async (): Promise<void> => {
  contextMenu.close()

  if (contextMenuCase.value === null || contextMenuCase.value === undefined) return

  const caseToDelete = contextMenuCase.value
  const confirmed = await dialogRef.value?.show(caseToDelete.name, caseToDelete.variant_count)

  if (confirmed === true) {
    // eslint-disable-next-line no-undef
    await window.api.cases.delete(caseToDelete.id)
    emit('case-deleted', caseToDelete.id)

    // If deleted case was selected, clear selection
    if (selected.value.includes(caseToDelete.id) === true) {
      selected.value = []
    }

    snackbarRef.value?.show(`Deleted "${caseToDelete.name}"`)
    await loadCases()
  }
}

// Helper functions for metadata display
function getCaseStatusIcon(caseId: number): string {
  const metadata = getMetadata(caseId)
  const status = metadata?.metadata?.affected_status ?? 'unknown'
  return STATUS_ICONS[status]
}

function getCaseStatusColor(caseId: number): string {
  const metadata = getMetadata(caseId)
  const status = metadata?.metadata?.affected_status ?? 'unknown'
  return STATUS_COLORS[status]
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
