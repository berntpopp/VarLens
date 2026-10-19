<script setup lang="ts">
/**
 * ShortlistPanel — host composition for the case-view Shortlist tab.
 *
 * Glues together the three building blocks from earlier waves:
 *
 *   • `useShortlistQuery`   (Wave 4)  — preset resolution + IPC fetch + loading/error state
 *   • `ShortlistTable`      (Wave 1.D) — presentational v-data-table leaf
 *   • `useApiService`       (existing) — typed IPC bridge for the star write-through
 *
 * Four visual states are routed from composable state:
 *
 *   loading  → skeleton rows on the first load only; refreshes keep the
 *              current rows (dimmed + thin progress bar, useTableLoadingState)
 *   error    → v-alert + Retry button
 *   empty    → "No variants matched the shortlist filters."
 *   success  → <ShortlistTable> with row-click / open-in-tab / toggle-star
 *              forwarded to the parent (CaseView, wired in Wave 6)
 *
 * `toggle-star` is absorbed internally — the panel writes through
 * `annotations.upsertPerCase` via `useApiService()` and relies on the
 * `variants:annotationChanged` broadcast (Wave 1.E) to trigger a refetch
 * via `useShortlistQuery`'s subscription. NO manual `refresh()` call here.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 */

import { computed, inject, ref, toRef, watch } from 'vue'
import { mdiInformationOutline, mdiRefresh, mdiTuneVariant } from '@mdi/js'
import IconButton from '../common/IconButton.vue'
import ShortlistTable from './ShortlistTable.vue'
import AnnotationDialogs from '../AnnotationDialogs.vue'
import TableLoadIndicator from '../table-state/TableLoadIndicator.vue'
import { useTableLoadingState } from '../../composables/useTableLoadingState'
import { useShortlistQuery } from '../../composables/useShortlistQuery'
import { useApiService } from '../../composables/useApiService'
import { useAnnotations } from '../../composables/useAnnotations'
import { useAcmgUndo } from '../../composables/useAcmgUndo'
import { logService } from '../../services/LogService'
import type { ShortlistRow, PerTypeTab } from '../../../../shared/types/shortlist'
import { isIpcError, unwrapIpcResult } from '../../../../shared/types/errors'
import {
  annotationCache,
  bumpKeyVersion,
  bumpWriteVersion,
  cacheSet,
  evictAnnotationCacheKeys,
  getAnnotationCacheEpoch,
  getCachedBuild,
  getCachedCaseId,
  getCachedVariantId,
  getCurrentDbPath,
  getWriteVersion,
  hasDbSwitchedSince,
  markAwaited,
  unloadedSlotOf,
  variantKey
} from '../../composables/annotation-cache'
import { usePermissions } from '../../composables/usePermissions'
import { useShortlistRankingDialog } from '../../composables/useShortlistRankingDialog'
import { SHORTLIST_RANKING_EDITOR } from '../../config/shortlistRankingEditor'
import { AppStateKey } from '../../composables/useAppState'

const { open: openRankingDialog } = useShortlistRankingDialog()

const { canWrite } = usePermissions()
const appState = inject(AppStateKey, null)

const props = defineProps<{
  caseId: number
  /** False while the Shortlist tab is hidden; forwarded to the table's key handlers. */
  interactive?: boolean
}>()

const emit = defineEmits<{
  (e: 'row-click', row: ShortlistRow): void
  (e: 'open-in-tab', variantType: PerTypeTab): void
}>()

const { api } = useApiService()

const caseIdRef = toRef(props, 'caseId')
const { shortlistPresets, selectedPresetId, result, loading, error, refresh, presetsLoading } =
  useShortlistQuery(caseIdRef)

const annotations = useAnnotations()
const annotationActions = { ...annotations, ...useAcmgUndo() }
const annotationDialogsRef = ref<InstanceType<typeof AnnotationDialogs> | null>(null)

watch(
  () => result.value?.rows,
  (rows) => {
    if (rows && rows.length > 0) {
      void annotations.loadAnnotationsBatch(props.caseId, rows)
    }
  },
  { immediate: true }
)

// Same loading presentation as the case/cohort tables (stale-while-revalidate)
const { showStale, ariaBusy, liveMessage } = useTableLoadingState({
  loading,
  totalCount: computed(() => result.value?.rows.length ?? null)
})

const hasNoPresets = computed(
  () => !loading.value && !presetsLoading?.value && shortlistPresets.value.length === 0
)

// Skeleton until the first result, not only while `loading`: the query starts
// asynchronously, so gating on loading left the body empty for a frame or two.
const showSkeleton = computed(() => {
  if (hasNoPresets.value) return false
  return result.value === null && error.value === null
})

// Plain-language explanation of how the shortlist is built: every matching
// variant is scored, the best N are shown (#537).
const shortlistExplanation = computed(() => {
  const r = result.value
  if (r === null) return ''
  return (
    `VarLens scores all ${r.totalCandidates} variants matching the preset and shows ` +
    `the best ${r.rows.length}. Use the variant-type tabs to browse everything. ` +
    `Ranked in ${r.elapsedMs} ms.`
  )
})

const pendingStarByRow = new Map<string, { target: boolean; token: number; writeVer: number }>()
let nextStarToggleToken = 0

/**
 * Toggle the star annotation for a row. Writes through
 * `annotations.upsertPerCase` and relies on the
 * `variants:annotationChanged` broadcast to drive the refetch — no
 * manual `refresh()` call here.
 */
async function onToggleStar(row: ShortlistRow): Promise<void> {
  if (api === undefined) {
    logService.warn('toggle star skipped: API unavailable', 'shortlist.panel')
    return
  }
  const dbPath = getCurrentDbPath()
  const epoch = getAnnotationCacheEpoch()
  const build = getCachedBuild()
  const key = variantKey(row)
  const rowKey = `${row.case_id}:${row.id}`
  const cachedPerCase = annotationCache.value.get(key)?.perCase
  const pending = pendingStarByRow.get(rowKey)
  const currentStarred =
    pending !== undefined && getWriteVersion(key, 'perCase:star') === pending.writeVer
      ? pending.target
      : cachedPerCase &&
          cachedPerCase.variant_id === row.id &&
          cachedPerCase.case_id === row.case_id
        ? cachedPerCase.starred === 1
        : row.is_starred
  const nextStarred = !currentStarred
  const writeVer = bumpWriteVersion(key, 'perCase:star')
  const toggleToken = ++nextStarToggleToken
  pendingStarByRow.set(rowKey, { target: nextStarred, token: toggleToken, writeVer })

  try {
    const updated = unwrapIpcResult(
      await api.annotations.upsertPerCase(row.case_id, row.id, {
        starred: nextStarred
      })
    )
    const activeCaseId = appState?.selectedCaseId?.value
    const stillOnScope =
      !hasDbSwitchedSince(dbPath) &&
      props.caseId === row.case_id &&
      (activeCaseId == null || activeCaseId === row.case_id) &&
      getAnnotationCacheEpoch() === epoch &&
      getCachedBuild() === build &&
      (getCachedCaseId() === null || getCachedCaseId() === row.case_id) &&
      getWriteVersion(key, 'perCase:star') === writeVer
    if (stillOnScope) {
      const liveEntry = annotationCache.value.get(key)
      const liveUnloaded = unloadedSlotOf(key)
      bumpKeyVersion(key)
      cacheSet(
        key,
        { global: liveEntry?.global ?? null, perCase: updated },
        liveEntry !== undefined && liveUnloaded !== 'global' ? undefined : 'global'
      )
    }
  } catch (e) {
    logService.error(
      `toggle star failed: ${
        e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
      }`,
      'shortlist.panel'
    )
  } finally {
    if (pendingStarByRow.get(rowKey)?.token === toggleToken) {
      pendingStarByRow.delete(rowKey)
    }
  }
}

let dialogOpenSeq = 0

function isRowAnnotationVerified(row: ShortlistRow): boolean {
  const key = variantKey(row)
  const cached = annotationCache.value.get(key)
  const cachedVid = getCachedVariantId(key)
  return (
    cached !== undefined &&
    unloadedSlotOf(key) === undefined &&
    cachedVid === row.id &&
    (cached.perCase === null ||
      (cached.perCase.variant_id === row.id && cached.perCase.case_id === row.case_id))
  )
}

async function prepareRowDialog(row: ShortlistRow): Promise<boolean> {
  const seq = ++dialogOpenSeq
  const key = variantKey(row)
  if (!isRowAnnotationVerified(row)) {
    evictAnnotationCacheKeys([key])
    if (typeof api?.annotations?.batchGet !== 'function') {
      appState?.showSnack('Failed to load variant annotations.', 'error')
      return false
    }
    markAwaited('case', key)
    await annotations.loadAnnotationsBatch(row.case_id, [row])
  }
  if (seq !== dialogOpenSeq || props.caseId !== row.case_id) {
    return false
  }
  if (!isRowAnnotationVerified(row)) {
    evictAnnotationCacheKeys([key])
    appState?.showSnack('Failed to load variant annotations.', 'error')
    return false
  }
  return true
}

async function onAcmgClick(row: ShortlistRow): Promise<void> {
  const ready = await prepareRowDialog(row)
  if (ready) {
    annotationDialogsRef.value?.openAcmgEvidenceDialog(row)
  }
}

async function onCommentClick(row: ShortlistRow): Promise<void> {
  const ready = await prepareRowDialog(row)
  if (ready) {
    annotationDialogsRef.value?.openCommentDialog(row)
  }
}

/** Clear the error banner so the user can dismiss stale failures. */
function dismissError(): void {
  error.value = null
}

async function handleTriageApplied(): Promise<void> {
  await refresh()
  if (result.value && props.caseId) {
    await annotations.loadAnnotationsBatch(props.caseId, result.value.rows)
  }
}
</script>

<template>
  <div class="shortlist-panel">
    <div class="shortlist-panel__header d-flex align-center ga-3 pa-2">
      <v-select
        v-model="selectedPresetId"
        :items="shortlistPresets"
        item-title="name"
        item-value="id"
        label="Preset"
        density="compact"
        hide-details
        variant="outlined"
        class="shortlist-panel__preset"
      />
      <!-- Always rendered, single line: the summary arriving with the first
           result must not resize the select or wrap the header taller (that
           pushed the table down: open-case CLS 0.11 on mobile). -->
      <div
        class="shortlist-panel__summary text-caption text-medium-emphasis"
        data-testid="shortlist-summary"
      >
        <template v-if="result">
          Top {{ result.rows.length }} of {{ result.totalCandidates }} matching candidates
          <IconButton
            label="How the shortlist is built"
            :tooltip="shortlistExplanation"
            :icon="mdiInformationOutline"
            size="x-small"
            class="ml-1"
          />
        </template>
      </div>
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        :prepend-icon="mdiTuneVariant"
        data-testid="shortlist-edit-ranking"
        @click="openRankingDialog(selectedPresetId)"
      >
        {{ SHORTLIST_RANKING_EDITOR.actions.editRanking }}
      </v-btn>
      <v-btn
        variant="text"
        size="small"
        :prepend-icon="mdiRefresh"
        :loading="loading"
        @click="refresh"
      >
        Refresh
      </v-btn>
    </div>

    <div
      class="shortlist-panel__body"
      :class="{ 'shortlist-panel__body--stale': showStale }"
      :aria-busy="ariaBusy"
    >
      <TableLoadIndicator :active="showStale" :message="liveMessage" />
      <div v-if="showSkeleton" data-testid="shortlist-loading" class="pa-3">
        <v-skeleton-loader type="table-row@5" />
      </div>

      <v-alert
        v-else-if="error"
        type="error"
        variant="tonal"
        class="ma-3"
        closable
        @click:close="dismissError"
      >
        {{ error.message }}
        <template #append>
          <v-btn variant="text" size="small" @click="refresh">Retry</v-btn>
        </template>
      </v-alert>

      <div
        v-else-if="hasNoPresets"
        class="pa-6 text-center text-medium-emphasis"
        data-testid="shortlist-empty-presets"
      >
        <v-icon size="large" class="mb-2" :icon="mdiTuneVariant" />
        <div class="text-body-1 font-weight-medium">No shortlist presets available</div>
        <div class="text-caption mt-1 mb-3">
          Configure a shortlist ranking preset to score and rank candidate variants.
        </div>
        <v-btn
          v-if="canWrite"
          variant="outlined"
          size="small"
          :prepend-icon="mdiTuneVariant"
          @click="openRankingDialog(null)"
        >
          {{ SHORTLIST_RANKING_EDITOR.actions.editRanking }}
        </v-btn>
      </div>

      <div
        v-else-if="result && result.rows.length === 0"
        class="pa-6 text-center text-medium-emphasis"
      >
        No variants matched the shortlist filters.
      </div>

      <ShortlistTable
        v-else-if="result"
        :case-id="caseId"
        :read-only="!canWrite"
        :interactive="interactive"
        :rows="result.rows"
        @row-click="(row) => emit('row-click', row)"
        @open-in-tab="(t) => emit('open-in-tab', t)"
        @toggle-star="onToggleStar"
        @acmg-click="onAcmgClick"
        @comment-click="onCommentClick"
        @triage-applied="handleTriageApplied"
      />
    </div>

    <AnnotationDialogs
      ref="annotationDialogsRef"
      :case-id="caseId"
      :annotation-actions="annotationActions"
      @changed="refresh"
    />
  </div>
</template>

<style scoped>
/*
 * The panel claims the full height of its parent (`.shortlist-region` in
 * CaseView.vue, which is `flex: 1 1 auto; min-height: 0` inside the
 * viewport-bounded `.case-content`). Without these rules the panel would
 * size to its intrinsic content and a long shortlist would overflow the
 * viewport without scrolling.
 */
.shortlist-panel {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}
.shortlist-panel__header {
  flex: 0 0 auto;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.shortlist-panel__preset {
  flex: 0 1 320px;
  min-width: 140px;
}
.shortlist-panel__summary {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/*
 * The body wrapper is the flex-grow region that hosts whichever of the
 * four state branches is active (loading / error / empty / success).
 * `min-height: 0` is required to let `ShortlistTable`'s nested overflow
 * container size correctly inside a flex parent.
 */
.shortlist-panel__body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* Refresh keeps rows visible, dimmed after a short delay (see useTableLoadingState) */
.shortlist-panel__body :deep(tbody) {
  transition: opacity 150ms ease-out;
}
.shortlist-panel__body--stale :deep(tbody) {
  opacity: 0.6;
}
@media (prefers-reduced-motion: reduce) {
  .shortlist-panel__body :deep(tbody) {
    transition: none;
  }
}
</style>
