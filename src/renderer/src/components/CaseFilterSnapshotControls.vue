<template>
  <div v-if="drawerState" class="d-inline-flex align-center ga-1">
    <v-divider vertical class="mx-1" />

    <!-- Save per-case filter snapshot -->
    <v-btn
      v-if="
        drawerState.hasActiveFilters.value || (drawerState.dslInput?.value?.trim() ?? '') !== ''
      "
      size="x-small"
      variant="text"
      color="secondary"
      :loading="saving"
      data-testid="case-snapshot-save"
      @click="handleSaveSnapshot"
    >
      <v-icon start size="x-small" :icon="mdiBookmarkPlusOutline" />
      Save case state
      <v-tooltip activator="parent" location="bottom">
        Save current filters as this case's analysis snapshot (with audit trail)
      </v-tooltip>
    </v-btn>

    <!-- Restore saved per-case filter snapshot -->
    <v-btn
      v-if="savedSnapshot !== null"
      size="x-small"
      variant="tonal"
      color="secondary"
      :loading="restoring"
      data-testid="case-snapshot-restore"
      @click="handleRestoreSnapshot"
    >
      <v-icon start size="x-small" :icon="mdiHistory" />
      Restore saved state
      <v-tooltip activator="parent" location="bottom">
        Restore saved case filter snapshot ({{ savedAtLabel }})
      </v-tooltip>
    </v-btn>

    <!-- One-click reset to defaults with confirmation when dirty or saved snapshot is active -->
    <v-btn
      v-if="drawerState.hasActiveFilters.value || savedSnapshot !== null"
      size="x-small"
      variant="text"
      color="warning"
      data-testid="case-snapshot-reset"
      @click="showResetDialog = true"
    >
      <v-icon start size="x-small" :icon="mdiRestore" />
      Reset defaults
      <v-tooltip activator="parent" location="bottom">
        Reset filters to default state (with confirmation)
      </v-tooltip>
    </v-btn>

    <!-- Drift warning chip when underlying case/annotation stamp changed since snapshot was saved -->
    <v-chip
      v-if="driftWarnings.length > 0"
      size="x-small"
      color="warning"
      variant="tonal"
      closable
      data-testid="case-snapshot-drift-warning"
      @click:close="driftWarnings = []"
    >
      <v-icon start size="x-small" :icon="mdiAlertOutline" />
      {{ driftWarnings.join('; ') }}
    </v-chip>

    <v-dialog v-model="showResetDialog" max-width="420">
      <v-card>
        <v-card-title class="text-subtitle-1">Reset case filters to defaults?</v-card-title>
        <v-card-text class="text-body-2">
          This clears all active filters and search terms for this case.
          <template v-if="savedSnapshot !== null">
            You can also clear the saved case filter snapshot from the audit-tracked case state.
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showResetDialog = false">Cancel</v-btn>
          <v-btn
            v-if="savedSnapshot !== null"
            variant="text"
            color="error"
            data-testid="case-snapshot-delete"
            @click="handleResetDefaults(true)"
          >
            Reset &amp; delete snapshot
          </v-btn>
          <v-btn
            variant="flat"
            color="warning"
            data-testid="case-snapshot-reset-confirm"
            @click="handleResetDefaults(false)"
          >
            Reset filters
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { mdiAlertOutline, mdiBookmarkPlusOutline, mdiHistory, mdiRestore } from '@mdi/js'
import { useApiService } from '../composables/useApiService'
import { logService } from '../services/LogService'
import { unwrapIpcResult } from '../../../shared/types/errors'
import { createFilterState } from '../../../shared/filters/filterDefaults'
import { decodeFilterSnapshot, encodeFilterSnapshot } from '../utils/url-state/view-query'
import {
  CASE_FILTER_RESTORE_ID_TYPE,
  CASE_FILTER_SNAPSHOT_ID_TYPE,
  diffCaseFilterSnapshotStamps,
  parseCaseFilterSnapshot,
  serializeCaseFilterSnapshot,
  type CaseFilterSnapshotPayload,
  type CaseFilterSnapshotStamp
} from '../../../shared/filters/case-filter-snapshot'
import type { FilterDrawerState } from './filterDrawerTypes'

const drawerState = inject<FilterDrawerState | undefined>('filterDrawerState', undefined)
const { api } = useApiService()

const savedSnapshot = ref<CaseFilterSnapshotPayload | null>(null)
const saving = ref(false)
const restoring = ref(false)
const showResetDialog = ref(false)
const driftWarnings = ref<string[]>([])

const savedAtLabel = computed(() => {
  if (savedSnapshot.value === null) return ''
  return new Date(savedSnapshot.value.saved_at).toLocaleString()
})

async function buildCurrentStamp(caseId: number): Promise<CaseFilterSnapshotStamp | null> {
  if (!api) return null
  let genomeBuild: string | null = null
  let variantCount: number | null = null
  try {
    const casesList = unwrapIpcResult(await api.cases.list())
    const found = casesList.find((c) => c.id === caseId)
    if (found !== undefined) {
      genomeBuild =
        found.genome_build !== undefined && found.genome_build !== ''
          ? found.genome_build
          : 'GRCh38'
      variantCount = found.variant_count ?? 0
    }
  } catch (e) {
    logService.warn(`Failed to read case stamp: ${String(e)}`, 'filters')
    return null
  }
  if (genomeBuild === null || variantCount === null) return null
  let hpoDataKey = 'none'
  try {
    const status = unwrapIpcResult(await api.hpoData.status())
    hpoDataKey = status.version ?? (status.installed ? 'installed' : 'none')
  } catch {
    // HPO status optional
  }
  return { genome_build: genomeBuild, hpo_data_key: hpoDataKey, variant_count: variantCount }
}

async function loadSavedSnapshot(caseId: number): Promise<void> {
  driftWarnings.value = []
  if (!api || caseId <= 0) {
    savedSnapshot.value = null
    return
  }
  try {
    const list = unwrapIpcResult(await api.caseMetadata.listExternalIds(caseId))
    if (drawerState !== undefined && drawerState.caseId.value !== caseId) return
    const row = list.find((item) => item.id_type === CASE_FILTER_SNAPSHOT_ID_TYPE)
    savedSnapshot.value = parseCaseFilterSnapshot(row?.id_value)
  } catch (e) {
    if (drawerState !== undefined && drawerState.caseId.value !== caseId) return
    logService.warn(`Failed to load case filter snapshot: ${String(e)}`, 'filters')
    savedSnapshot.value = null
  }
}

if (drawerState) {
  watch(
    () => drawerState.caseId.value,
    (id) => {
      void loadSavedSnapshot(id)
    },
    { immediate: true }
  )
}

async function handleSaveSnapshot(): Promise<void> {
  if (!drawerState || !api) return
  const caseId = drawerState.caseId.value
  saving.value = true
  try {
    const stamp = (await buildCurrentStamp(caseId)) ?? {
      genome_build: 'GRCh38',
      hpo_data_key: 'none',
      variant_count: 0
    }
    const encoded = encodeFilterSnapshot(
      drawerState.filters.value,
      drawerState.selectedImpactPresets.value
    )
    const { state: filterDiff, impact } = decodeFilterSnapshot(encoded)
    const searchQuery = drawerState.dslInput?.value ?? drawerState.filters.value.searchQuery
    const payload: CaseFilterSnapshotPayload = {
      v: 1,
      saved_at: Date.now(),
      stamp,
      filters: filterDiff,
      ...(impact.length > 0 ? { impact } : {}),
      searchQuery
    }
    const raw = serializeCaseFilterSnapshot(payload)
    unwrapIpcResult(
      await api.caseMetadata.upsertExternalId(caseId, CASE_FILTER_SNAPSHOT_ID_TYPE, raw)
    )
    savedSnapshot.value = payload
    driftWarnings.value = []
  } catch (e) {
    logService.warn(`Failed to save case filter snapshot: ${String(e)}`, 'filters')
  } finally {
    saving.value = false
  }
}

async function handleRestoreSnapshot(): Promise<void> {
  if (!drawerState || !api || savedSnapshot.value === null) return
  const caseId = drawerState.caseId.value
  restoring.value = true
  try {
    const snap = savedSnapshot.value
    const query = snap.searchQuery ?? ''
    drawerState.filters.value = {
      ...createFilterState(),
      ...(snap.filters ?? {}),
      searchQuery: query
    }
    drawerState.selectedImpactPresets.value = [...(snap.impact ?? [])]
    if (drawerState.dslInput) {
      drawerState.dslInput.value = query
      drawerState.onDslApply?.()
    }
    const raw = serializeCaseFilterSnapshot(snap)
    unwrapIpcResult(
      await api.caseMetadata.upsertExternalId(caseId, CASE_FILTER_RESTORE_ID_TYPE, raw)
    )
    const currentStamp = await buildCurrentStamp(caseId)
    driftWarnings.value =
      currentStamp !== null ? diffCaseFilterSnapshotStamps(snap.stamp, currentStamp) : []
  } catch (e) {
    logService.warn(`Failed to restore case filter snapshot: ${String(e)}`, 'filters')
  } finally {
    restoring.value = false
  }
}

async function handleResetDefaults(deleteSnapshot: boolean): Promise<void> {
  showResetDialog.value = false
  if (!drawerState) return
  drawerState.clearAllFilters()
  drawerState.onDslClear?.()
  driftWarnings.value = []
  if (deleteSnapshot && api && savedSnapshot.value !== null) {
    try {
      unwrapIpcResult(
        await api.caseMetadata.deleteExternalId(
          drawerState.caseId.value,
          CASE_FILTER_SNAPSHOT_ID_TYPE
        )
      )
      savedSnapshot.value = null
    } catch (e) {
      logService.warn(`Failed to delete case filter snapshot: ${String(e)}`, 'filters')
    }
  }
}
</script>
