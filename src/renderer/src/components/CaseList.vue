<template>
  <v-text-field
    v-model="searchTerm"
    :prepend-inner-icon="mdiMagnify"
    placeholder="Search cases..."
    density="compact"
    hide-details
    clearable
    class="mx-2 mt-2"
  />

  <div class="case-filters-stack mx-2 mt-1">
    <v-select
      v-model="selectedCohortIds"
      :items="cohortGroupsCache"
      item-title="name"
      item-value="id"
      :prepend-inner-icon="mdiAccountGroup"
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
      v-model="selectedHpoIds"
      :items="availableHpoTerms"
      item-title="label"
      item-value="hpo_id"
      :prepend-inner-icon="mdiHuman"
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

  <v-infinite-scroll :key="scrollKey" :empty-text="emptyText" @load="onLoad">
    <!-- Empty state (shown when no cases after first load completes) -->
    <template v-if="cases.length === 0 && !loading" #empty>
      <v-list-item>
        <v-list-item-title class="text-grey text-center py-4">
          <template v-if="hasActiveFilters">
            <v-icon class="mb-1" :icon="mdiFilterOff" />
            <div>No matching cases</div>
          </template>
          <template v-else>
            <v-icon class="mb-1" :icon="mdiFolderOpenOutline" />
            <div>No cases yet</div>
            <div class="text-body-small mt-1">Click + to import</div>
          </template>
        </v-list-item-title>
      </v-list-item>
    </template>

    <v-skeleton-loader
      v-if="loading && cases.length === 0"
      type="list-item-two-line@8"
      class="case-list-skeleton"
    />

    <v-list v-model:selected="selected" density="compact" select-strategy="single-leaf">
      <!-- Case items -->
      <v-list-item
        v-for="caseItem in cases"
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
            :icon="isMultiSelected(caseItem.id) ? mdiCheckboxMarked : mdiCheckboxBlankOutline"
            :color="isMultiSelected(caseItem.id) ? 'primary' : 'grey'"
            size="small"
            class="mr-2"
          />
          <!-- Status + sex icons when not in multi-select mode -->
          <CaseStatusIcons
            v-else
            :status="caseStatus(caseItem)"
            :sex="caseSex(caseItem)"
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
              v-for="name in caseItem.cohort_names.slice(0, 3)"
              :key="name"
              :color="getCohortColor(name)"
              size="x-small"
              label
            >
              {{ name }}
            </v-chip>
            <v-chip v-if="caseItem.cohort_names.length > 3" size="x-small" color="grey" label>
              +{{ caseItem.cohort_names.length - 3 }}
            </v-chip>
          </div>
        </template>
      </v-list-item>
    </v-list>
  </v-infinite-scroll>

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
          <v-icon :icon="mdiPencil" />
        </template>
        <v-list-item-title>Edit</v-list-item-title>
      </v-list-item>
      <v-divider />
      <!-- Delete selected when multi-select active -->
      <v-list-item v-if="isMultiSelectMode" @click="handleDeleteSelected">
        <template #prepend>
          <v-icon color="error" :icon="mdiDelete" />
        </template>
        <v-list-item-title>Delete {{ multiSelectedCount }} Selected</v-list-item-title>
      </v-list-item>
      <!-- Single delete option -->
      <v-list-item @click="handleDelete">
        <template #prepend>
          <v-icon :icon="mdiDelete" />
        </template>
        <v-list-item-title>Delete</v-list-item-title>
      </v-list-item>
      <!-- Clear selection when multi-select active -->
      <v-list-item v-if="isMultiSelectMode" @click="clearMultiSelect">
        <template #prepend>
          <v-icon :icon="mdiSelectionOff" />
        </template>
        <v-list-item-title>Clear Selection</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <DeleteCaseDialog ref="dialogRef" />
  <AppSnackbar ref="snackbarRef" />
</template>

<script setup lang="ts">
import { ref, computed, watch, shallowRef, markRaw } from 'vue'
import type { CaseWithCohorts, CaseSex, AffectedStatus } from '../../../shared/types/api'
import { useContextMenu } from '../composables/useContextMenu'
import { logService } from '../services/LogService'

const VALID_AFFECTED: Set<string> = new Set(['affected', 'unaffected', 'unknown'])
const VALID_SEX: Set<string> = new Set(['unknown', 'male', 'female', 'other'])

function toAffectedStatus(value: string | null | undefined): AffectedStatus {
  return value != null && VALID_AFFECTED.has(value) ? (value as AffectedStatus) : 'unknown'
}

function toCaseSex(value: string | null | undefined): CaseSex {
  return value != null && VALID_SEX.has(value) ? (value as CaseSex) : 'unknown'
}
import { useCaseMetadata, getCohortColor } from '../composables/useCaseMetadata'
import { useDebounce } from '../composables/useDebounce'
import { useApiService } from '../composables/useApiService'
import CaseStatusIcons from './CaseStatusIcons.vue'
import DeleteCaseDialog from './DeleteCaseDialog.vue'
import AppSnackbar from './AppSnackbar.vue'
import {
  mdiAccountGroup,
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiDelete,
  mdiFilterOff,
  mdiFolderOpenOutline,
  mdiHuman,
  mdiMagnify,
  mdiPencil,
  mdiSelectionOff
} from '@mdi/js'

const PAGE_SIZE = 50

const emit = defineEmits<{
  'case-selected': [caseId: number, caseName: string, variantCount: number, createdAt: number]
  'case-deleted': [caseId: number]
  'cases-loaded': [count: number]
  'edit-case': [caseId: number, caseName: string, variantCount: number, createdAt: number]
}>()

// State
const cases = shallowRef<CaseWithCohorts[]>([])
const loading = ref(false)
const searchTerm = ref('')
const selectedCohortIds = ref<number[]>([])
const selectedHpoIds = ref<string[]>([])
const selected = ref<number[]>([])
const contextMenuCase = ref<CaseWithCohorts | null>(null)
const contextMenu = useContextMenu()
const { api } = useApiService()

// Infinite scroll state
const currentOffset = ref(0)
const totalCaseCount = ref(0)
const scrollKey = ref(0)

// Multi-select state
const multiSelected = ref<Set<number>>(new Set())
const isMultiSelectMode = computed(() => multiSelected.value.size > 0)
const multiSelectedCount = computed(() => multiSelected.value.size)
const isMultiSelected = (id: number): boolean => multiSelected.value.has(id)

// Load cohort groups for filter dropdown + reactive metadata for sidebar icons
const { loadCohortGroups, cohortGroupsCache, metadataCache } = useCaseMetadata()

// Reactive status/sex that prefer metadata cache over stale query data
function caseStatus(caseItem: CaseWithCohorts): AffectedStatus {
  const cached = metadataCache.value.get(caseItem.id)
  return toAffectedStatus(cached?.metadata?.affected_status ?? caseItem.affected_status)
}
function caseSex(caseItem: CaseWithCohorts): CaseSex {
  const cached = metadataCache.value.get(caseItem.id)
  return toCaseSex(cached?.metadata?.sex ?? caseItem.sex)
}

// Component refs
const dialogRef = ref<InstanceType<typeof DeleteCaseDialog> | null>(null)
const snackbarRef = ref<InstanceType<typeof AppSnackbar> | null>(null)

// Available HPO terms for filter autocomplete
const availableHpoTerms = ref<Array<{ hpo_id: string; label: string }>>([])

// Load distinct HPO terms assigned across all cases
async function loadHpoTerms(): Promise<void> {
  if (!api) return
  try {
    const terms = await api.caseMetadata.distinctHpoTerms()
    availableHpoTerms.value = terms.map((t) => ({
      hpo_id: t.hpo_id,
      label: `${t.hpo_label} (${t.hpo_id})`
    }))
  } catch (e) {
    logService.warn(
      'Failed to load HPO terms: ' + (e instanceof Error ? e.message : String(e)),
      'case-list'
    )
    availableHpoTerms.value = []
  }
}

// Whether any filter is active (for empty-state messaging)
const hasActiveFilters = computed(
  () => !!searchTerm.value || selectedCohortIds.value.length > 0 || selectedHpoIds.value.length > 0
)

// Empty text for infinite scroll
const emptyText = computed(() => {
  if (cases.value.length === 0) return ''
  return 'All cases loaded'
})

// Infinite scroll load handler
const onLoad = async ({
  done
}: {
  side: string
  done: (status: 'ok' | 'empty' | 'error') => void
}): Promise<void> => {
  if (!api) {
    done('empty')
    return
  }

  loading.value = true
  try {
    const result = await api.cases.query({
      limit: PAGE_SIZE,
      offset: currentOffset.value,
      search_term: searchTerm.value || undefined,
      cohort_ids: selectedCohortIds.value.length > 0 ? [...selectedCohortIds.value] : undefined,
      hpo_ids: selectedHpoIds.value.length > 0 ? [...selectedHpoIds.value] : undefined,
      sort_by: 'created_at',
      sort_order: 'desc',
      _count_needed: currentOffset.value === 0
    })

    cases.value = markRaw([...cases.value, ...result.data])

    if (currentOffset.value === 0) {
      totalCaseCount.value = result.total_count
      emit('cases-loaded', result.total_count)
    }

    currentOffset.value += result.data.length
    done(result.data.length < PAGE_SIZE ? 'empty' : 'ok')
  } catch (e) {
    logService.error(
      'Failed to load cases page: ' + (e instanceof Error ? e.message : String(e)),
      'case-list'
    )
    done('error')
  } finally {
    loading.value = false
  }
}

// Reset list (for search/filter changes)
const resetList = (): void => {
  cases.value = markRaw([])
  currentOffset.value = 0
  scrollKey.value++
}

const { debouncedFn: debouncedReset } = useDebounce(resetList, 300)

watch(searchTerm, debouncedReset)
watch(selectedCohortIds, resetList)
watch(selectedHpoIds, resetList)

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
const handleCaseClick = (event: MouseEvent | KeyboardEvent, caseItem: CaseWithCohorts): void => {
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
const handleContextMenu = (event: MouseEvent, caseItem: CaseWithCohorts): void => {
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
  if (confirmed !== true) return

  // ── Optimistic UI update ──
  // The IPC handler already runs the delete inside a worker thread on the
  // main process (see src/main/ipc/handlers/cases-logic.ts#deleteSingleCase),
  // but the renderer was previously `await`ing the whole operation — which
  // meant the deleted case stayed visible for the full duration of the
  // worker run (seconds for large cases). That opened a window where a
  // user could re-click the deleted case, navigate into it, or click
  // delete again. We now remove the case from the list immediately and
  // fire the IPC async; failures re-insert the case and show an error
  // snackbar.
  const deletedId = caseToDelete.id
  const deletedName = caseToDelete.name
  const priorIndex = cases.value.findIndex((c) => c.id === deletedId)
  const priorSnapshot = priorIndex >= 0 ? cases.value[priorIndex] : null

  // Remove from the visible list + clear any stale selection state.
  cases.value = markRaw(cases.value.filter((c) => c.id !== deletedId))
  if (totalCaseCount.value > 0) totalCaseCount.value -= 1
  if (selected.value.includes(deletedId) === true) {
    selected.value = []
  }
  if (multiSelected.value.has(deletedId)) {
    const newSet = new Set(multiSelected.value)
    newSet.delete(deletedId)
    multiSelected.value = newSet
  }

  // Emit so the parent (App.vue) can clear its own routing state — crucial
  // because the app-level `selectedCaseId` keeps the variant panel open on
  // the now-deleted case otherwise.
  emit('case-deleted', deletedId)
  snackbarRef.value?.show(`Deleting "${deletedName}"…`)

  // Fire-and-forget — still catch errors and roll back the optimistic
  // update if the worker rejects the delete. We intentionally do NOT
  // `await` so the UI stays responsive during large deletes.
  api!.cases
    .delete(deletedId)
    .then(() => {
      snackbarRef.value?.show(`Deleted "${deletedName}"`)
    })
    .catch((error) => {
      logService.error(
        `Failed to delete case ${deletedId}: ${error instanceof Error ? error.message : String(error)}`,
        'case-list'
      )
      // Roll back: re-insert at the original position.
      if (priorSnapshot !== null) {
        const next = [...cases.value]
        const insertAt = Math.min(priorIndex, next.length)
        next.splice(insertAt, 0, priorSnapshot)
        cases.value = markRaw(next)
        totalCaseCount.value += 1
      }
      snackbarRef.value?.show(
        `Failed to delete "${deletedName}": ${error instanceof Error ? error.message : String(error)}`
      )
    })
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
  if (confirmed !== true) return

  // ── Optimistic UI update (same rationale as handleDelete above) ──
  const idSet = new Set(ids)
  const priorSnapshots = cases.value.filter((c) => idSet.has(c.id))
  cases.value = markRaw(cases.value.filter((c) => !idSet.has(c.id)))
  if (totalCaseCount.value > 0) {
    totalCaseCount.value = Math.max(0, totalCaseCount.value - ids.length)
  }

  // Clear single selection if it was part of the batch
  if (selected.value.length > 0 && ids.includes(selected.value[0])) {
    selected.value = []
  }
  multiSelected.value = new Set()

  // Emit so the parent clears routing state for any currently-selected case.
  for (const id of ids) {
    emit('case-deleted', id)
  }
  snackbarRef.value?.show(`Deleting ${ids.length} ${ids.length === 1 ? 'case' : 'cases'}…`)

  api!.cases
    .deleteBatch(ids)
    .then((deleted) => {
      snackbarRef.value?.show(`Deleted ${deleted} ${deleted === 1 ? 'case' : 'cases'}`)
    })
    .catch((error) => {
      logService.error(
        `Failed to delete cases [${ids.join(', ')}]: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'case-list'
      )
      // Roll back: re-insert all affected cases. Order is approximate
      // (they may not land in their original positions) but they reappear.
      if (priorSnapshots.length > 0) {
        cases.value = markRaw([...priorSnapshots, ...cases.value])
        totalCaseCount.value += priorSnapshots.length
      }
      snackbarRef.value?.show(
        `Failed to delete cases: ${error instanceof Error ? error.message : String(error)}`
      )
    })
}

// Expose methods for parent to call after import/delete/db-switch
const refreshCases = async (): Promise<void> => {
  await Promise.all([loadCohortGroups(), loadHpoTerms()])
  resetList()
}

const selectCase = (caseId: number): void => {
  selected.value = [caseId]
}

defineExpose({ refreshCases, selectCase })

// Load filter dropdown data on mount
loadCohortGroups()
loadHpoTerms()
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
