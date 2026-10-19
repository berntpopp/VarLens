<script setup lang="ts">
/**
 * ShortlistTable — pure presentational v-data-table specialized for the
 * case Shortlist tab.
 *
 * Receives `rows: ShortlistRow[]` as a prop and emits `row-click`,
 * `open-in-tab`, and `toggle-star`. No composable, no IPC — composition
 * into a host panel lives in ShortlistPanel.vue (Wave 5).
 *
 * Columns: # / Score / Type / Gene / Variant / Impact / AF / ClinVar /
 * ★ / actions / Links (the merged link-out column shared with the case and
 * cohort tables). `rank_score` is non-sortable (ranking is the feature);
 * `variant_notation` is computed in the renderer from per-type fields so
 * SV / CNV / STR rows get type-appropriate notation. Type chips use
 * explicit palette colors per the CLAUDE.md "no surface-variant" rule.
 *
 * Spec: .planning/specs/2026-04-11-unified-shortlist-ranked-view-design.md (§6)
 */

import { ref, computed, inject, onUnmounted, watch, onActivated, onDeactivated } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import {
  mdiStar,
  mdiStarOutline,
  mdiDotsVertical,
  mdiClipboardCheckOutline,
  mdiCommentText,
  mdiCommentTextOutline
} from '@mdi/js'
import RankScoreTooltip from './RankScoreTooltip.vue'
import { formatRankScore } from '../../utils/formatters'
import { useRowHoverTarget } from './useRowHoverTarget'
import { CellChip, CellIcon } from '../table-cells/cell-components'
import { ClinVarCell, LinkOutsCell } from '../table-cells/simple-cells'
import { linksColumn } from '../variant-table/columns'
import { resolveRowLinks, useLinkResolvers } from '../../composables/useLinkResolvers'
import { useVariantLinks } from '../../composables/useVariantLinks'
import { useSharedMenu } from '../table-cells/shared-menu'
import { useResultSetKeys } from '../table-state/useResultSetKeys'
import { EMPTY_VALUE_PLACEHOLDER } from '../../config/displayConfig'
import ShortlistVariantCell from './ShortlistVariantCell.vue'
import {
  baseHeaders,
  variantCell,
  pinFor,
  typeChipColor,
  targetTabFor,
  displayVariantType,
  hasCommentFor as hasCommentForHelper
} from './shortlist-table-helpers'
import {
  useTableKeyboardNav,
  isControlFocused,
  isInputFocused,
  hasCommandModifier
} from '../../composables/useTableKeyboardNav'
import type { ShortlistRow } from '../../../../shared/types/shortlist'
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import ProteinViewMenuItem from '../protein/ProteinViewMenuItem.vue'
import { useProteinViewShortcut } from '../../composables/useProteinViewShortcut'
import { AppStateKey } from '../../composables/useAppState'
import { annotationCache, ACMG_COLORS, ACMG_ABBREV } from '../../composables/useAnnotations'
import { variantKey, getPerCaseByVariantId } from '../../composables/annotation-cache'
import { useBulkTriageSelection } from '../../composables/useBulkTriageSelection'
import BulkTriageActionBar from '../variant-table/BulkTriageActionBar.vue'

const props = defineProps<{
  rows: ShortlistRow[]
  caseId?: number | null
  /** Viewer role: the star is display-only. */
  readOnly?: boolean
  /** False while the tab is hidden (v-show): window keys must not act on unseen rows. */
  interactive?: boolean
}>()

const emit = defineEmits<{
  (e: 'row-click', row: ShortlistRow): void
  (e: 'open-in-tab', variantType: 'snv' | 'sv' | 'cnv' | 'str'): void
  (e: 'toggle-star', row: ShortlistRow): void
  (e: 'acmg-click', row: ShortlistRow): void
  (e: 'comment-click', row: ShortlistRow): void
  (e: 'triage-applied'): void
}>()

// Link-outs resolve exactly like the case/cohort tables (shared resolvers)
const { resolvers: linkResolvers, linkOuts } = useLinkResolvers()
const { openExternalLink } = useVariantLinks()
const headers = computed(() => [...baseHeaders, ...linksColumn(linkOuts.value.length)])
const rowLinks = computed(() => {
  const byId = new Map<number, Record<string, string | null>>()
  for (const row of props.rows) byId.set(row.id, resolveRowLinks(row, linkResolvers.value))
  return byId
})

// Shared per-row overlays (one instance per table instead of one per row)
const rankTip = useRowHoverTarget('data-rank-tip')
const rankTipRow = computed(() =>
  rankTip.rowId.value === null
    ? null
    : (props.rows.find((r) => String(r.id) === rankTip.rowId.value) ?? null)
)

const actionsMenu = useSharedMenu<ShortlistRow>()
const { open: actionsOpen, activator: actionsActivator, payload: actionsRow } = actionsMenu

// Fresh <tr>s when another case/preset result arrives: moved rows are layout shifts
const { rowKey } = useResultSetKeys(
  () => props.rows,
  (row) => row.id
)

// Keyboard navigation and row selection
const isComponentActive = ref(true)
onActivated(() => {
  isComponentActive.value = true
})
onDeactivated(() => {
  isComponentActive.value = false
  clearArrowSyncTimer()
})

const currentItems = ref<ShortlistRow[] | null>(null)
watch(
  () => props.rows,
  () => {
    currentItems.value = null
  }
)
function onCurrentItems(items: ReadonlyArray<{ raw?: ShortlistRow } | ShortlistRow>): void {
  currentItems.value = items.map((it) =>
    it !== null && typeof it === 'object' && 'raw' in it && it.raw ? it.raw : (it as ShortlistRow)
  )
}
const displayedRows = computed(() => currentItems.value ?? props.rows)

const { selectedItem, selectByClick, moveUp, moveDown, clearSelection } = useTableKeyboardNav({
  items: displayedRows,
  getItemId: (item: ShortlistRow) => item.id,
  onSelect: (_item: ShortlistRow) => {}
})

useProteinViewShortcut(() =>
  !isComponentActive.value || props.interactive === false ? null : selectedItem.value
)

function getRowProps({ item }: { item: ShortlistRow }) {
  return { class: { 'variant-row--selected': selectedItem.value?.id === item.id } }
}

function getAcmgFor(item: ShortlistRow): AcmgClassification | null {
  const k = variantKey(item)
  const perCase = getPerCaseByVariantId(item.case_id, item.id, k)
  return (
    perCase?.acmg_classification ??
    annotationCache.value.get(k)?.global?.acmg_classification ??
    null
  )
}

function hasCommentFor(item: ShortlistRow): boolean {
  return hasCommentForHelper(item, annotationCache.value)
}

function isStarredFor(item: ShortlistRow): boolean {
  const perCase = getPerCaseByVariantId(item.case_id, item.id, variantKey(item))
  if (perCase != null) return perCase.starred === 1
  return item.is_starred
}

const sortBy = ref<Array<{ key: string; order?: 'asc' | 'desc' }>>([])

const appState = inject(AppStateKey, null)
const caseId = computed(
  () => props.caseId ?? appState?.selectedCaseId?.value ?? props.rows[0]?.case_id ?? null
)
const bulkSelection = useBulkTriageSelection({
  items: () => displayedRows.value,
  getItemId: (r) => r.id,
  caseId,
  onTriageApplied: () => emit('triage-applied')
})

watch(
  () => props.readOnly,
  (ro) => {
    if (ro) bulkSelection.clearSelection()
  }
)

let arrowSyncTimer: ReturnType<typeof setTimeout> | null = null
let arrowSyncGen = 0

function clearArrowSyncTimer(): void {
  arrowSyncGen++
  if (arrowSyncTimer !== null) clearTimeout(arrowSyncTimer)
  arrowSyncTimer = null
}

watch(
  () => props.interactive,
  (ok) => {
    if (!ok) clearArrowSyncTimer()
  }
)

if (appState) {
  watch(
    () => appState.selectedPanelVariant.value,
    (variant) => {
      if (variant && 'id' in variant && props.rows.some((v) => v.id === variant.id)) {
        selectByClick(variant as ShortlistRow)
      } else {
        clearSelection()
      }
    },
    { immediate: true }
  )
}

function canSyncDetails(): boolean {
  return (
    isComponentActive.value && props.interactive !== false && appState?.panelOpen.value === true
  )
}

function triggerDebouncedPanelSync(): void {
  clearArrowSyncTimer()
  if (!appState || !canSyncDetails() || !selectedItem.value) return
  const currentAppState = appState
  const gen = arrowSyncGen
  arrowSyncTimer = setTimeout(async () => {
    arrowSyncTimer = null
    if (!canSyncDetails() || selectedItem.value === null || gen !== arrowSyncGen) return
    const leavePromise = currentAppState.confirmPanelLeave?.() ?? null
    if (leavePromise !== null) {
      const ok = await leavePromise
      if (gen !== arrowSyncGen) return
      if (!ok) {
        if (
          currentAppState.selectedPanelVariant.value &&
          'id' in currentAppState.selectedPanelVariant.value
        ) {
          selectByClick(currentAppState.selectedPanelVariant.value as ShortlistRow)
        }
        return
      }
    }
    if (!canSyncDetails() || selectedItem.value === null || gen !== arrowSyncGen) return
    emit('row-click', selectedItem.value)
  }, 100)
}

onUnmounted(clearArrowSyncTimer)

function handleRowClick(item: ShortlistRow): void {
  clearArrowSyncTimer()
  selectByClick(item)
  emit('row-click', item)
}

for (const [key, move] of [
  ['ArrowDown', moveDown],
  ['ArrowUp', moveUp]
] as const) {
  onKeyStroke(
    key,
    (e: KeyboardEvent) => {
      if (!isComponentActive.value || props.interactive === false) return
      if (isInputFocused() || props.rows.length === 0) return
      e.preventDefault()
      move()
      triggerDebouncedPanelSync()
    },
    { dedupe: true }
  )
}

onKeyStroke(
  ['Enter', 'i'],
  (e: KeyboardEvent) => {
    if (!isComponentActive.value || props.interactive === false) return
    if (isInputFocused() || isControlFocused() || !selectedItem.value) return
    e.preventDefault()
    emit('row-click', selectedItem.value)
  },
  { dedupe: true }
)

const actionHandlers: Record<string, () => void> = {
  s: () => {
    if (!selectedItem.value) return
    emit('toggle-star', { ...selectedItem.value, is_starred: isStarredFor(selectedItem.value) })
  },
  a: () => emit('acmg-click', selectedItem.value!),
  c: () => emit('comment-click', selectedItem.value!)
}
for (const [key, handler] of Object.entries(actionHandlers)) {
  onKeyStroke(
    key,
    (e: KeyboardEvent) => {
      if (!isComponentActive.value || props.interactive === false) return
      if (hasCommandModifier(e) || isInputFocused() || !selectedItem.value) return
      if (props.readOnly === true) return
      e.preventDefault()
      handler()
    },
    { dedupe: true }
  )
}

onKeyStroke(
  'Escape',
  (e: KeyboardEvent) => {
    if (
      !isComponentActive.value ||
      props.interactive === false ||
      e.defaultPrevented ||
      isInputFocused()
    )
      return
    if (appState?.panelOpen.value === true) {
      e.preventDefault()
      appState.panelOpen.value = false
      return
    }
    bulkSelection.clearSelection()
    clearSelection()
  },
  { dedupe: true }
)
</script>

<template>
  <v-data-table
    v-model:sort-by="sortBy"
    :headers="headers"
    :items="props.rows"
    :item-value="rowKey"
    density="compact"
    :show-select="!props.readOnly"
    :items-per-page="50"
    :items-per-page-options="[25, 50, 100, 250, 500]"
    class="shortlist-data-table"
    :row-props="getRowProps"
    @update:current-items="onCurrentItems"
    @click:row="(_: MouseEvent, { item }: { item: ShortlistRow }) => handleRowClick(item)"
    @mouseover="rankTip.onMouseover"
    @mouseout="rankTip.onMouseout"
    @focusin="rankTip.onFocusin"
    @focusout="rankTip.onFocusout"
  >
    <template #[`header.data-table-select`]>
      <input
        type="checkbox"
        :checked="bulkSelection.isAllSelected.value"
        :indeterminate="bulkSelection.isSomeSelected.value"
        aria-label="Select all rows"
        data-testid="bulk-select-all"
        class="bulk-select-checkbox"
        @change="bulkSelection.toggleSelectAll(($event.target as HTMLInputElement).checked)"
      />
    </template>

    <template #[`item.data-table-select`]="{ item }">
      <input
        type="checkbox"
        :checked="bulkSelection.isSelected(item.id)"
        :aria-label="`Select variant ${item.id}`"
        :data-testid="`bulk-select-row-${item.id}`"
        class="bulk-select-checkbox"
        @click.stop="bulkSelection.handleRowCheckboxClick(item.id, $event)"
      />
    </template>

    <!-- Score breakdown: one shared tooltip (below), not a v-tooltip per row -->
    <template #[`item.rank_score`]="{ item }">
      <span :data-rank-tip="item.id" tabindex="0" @keydown.esc="rankTip.close">{{
        formatRankScore(item)
      }}</span>
    </template>

    <template #[`item.variant_type`]="{ item }">
      <CellChip :color="typeChipColor(item.variant_type)" size="x-small" variant="flat">
        {{ displayVariantType(item.variant_type) }}
      </CellChip>
    </template>

    <template #[`item.variant_notation`]="{ item }">
      <ShortlistVariantCell :cell="variantCell(item)" />
    </template>

    <template #[`item.clinvar`]="{ item }">
      <ClinVarCell :significance="item.clinvar" />
    </template>

    <template #[`item.gnomad_af`]="{ item }">
      {{ item.gnomad_af == null ? EMPTY_VALUE_PLACEHOLDER : item.gnomad_af.toExponential(2) }}
    </template>

    <!-- Native buttons + static icons: no VBtn/VIcon instances per row -->
    <template #[`item.is_starred`]="{ item }">
      <div class="d-flex align-center ga-1">
        <button
          type="button"
          class="annotation-btn"
          :aria-label="isStarredFor(item) ? 'Unstar variant' : 'Star variant'"
          :aria-pressed="isStarredFor(item)"
          :data-testid="`shortlist-star-${item.id}`"
          :disabled="props.readOnly === true"
          @click.stop="emit('toggle-star', { ...item, is_starred: isStarredFor(item) })"
        >
          <CellIcon
            class="shortlist-row-icon"
            :color="isStarredFor(item) ? 'primary' : null"
            :icon="isStarredFor(item) ? mdiStar : mdiStarOutline"
          />
        </button>
        <button
          type="button"
          class="annotation-btn"
          :aria-label="getAcmgFor(item) ? `ACMG: ${getAcmgFor(item)}` : 'Set ACMG classification'"
          :data-testid="`shortlist-acmg-${item.id}`"
          :disabled="props.readOnly === true"
          @click.stop="emit('acmg-click', item)"
        >
          <CellChip
            v-if="getAcmgFor(item)"
            :color="ACMG_COLORS[getAcmgFor(item)!]"
            size="x-small"
            label
          >
            {{ ACMG_ABBREV[getAcmgFor(item)!] }}
          </CellChip>
          <CellIcon v-else :icon="mdiClipboardCheckOutline" size="x-small" color="muted" />
        </button>
        <button
          type="button"
          class="annotation-btn"
          :aria-label="hasCommentFor(item) ? 'Edit comment' : 'Add comment'"
          :data-testid="`shortlist-comment-${item.id}`"
          @click.stop="emit('comment-click', item)"
        >
          <CellIcon
            :icon="hasCommentFor(item) ? mdiCommentText : mdiCommentTextOutline"
            :color="hasCommentFor(item) ? 'primary' : 'muted'"
            size="x-small"
          />
        </button>
      </div>
    </template>

    <template #[`item.actions`]="{ item }">
      <button
        type="button"
        class="annotation-btn"
        aria-label="Variant actions"
        aria-haspopup="menu"
        :aria-expanded="actionsMenu.open.value && actionsMenu.payload.value?.id === item.id"
        :data-testid="`shortlist-actions-${item.id}`"
        @click.stop="actionsMenu.toggle($event.currentTarget as HTMLElement, item)"
      >
        <CellIcon class="shortlist-row-icon" :icon="mdiDotsVertical" />
      </button>
    </template>

    <template #[`item._links`]="{ item }">
      <LinkOutsCell
        :links="linkOuts"
        :urls="rowLinks.get(item.id) ?? {}"
        @click="openExternalLink"
      />
    </template>
  </v-data-table>

  <!-- One shared actions menu and one score tooltip for all rows -->
  <v-menu v-model="actionsOpen" :activator="actionsActivator ?? undefined" :open-on-click="false">
    <v-list v-if="actionsRow" density="compact">
      <v-list-item @click="emit('row-click', actionsRow)">
        <v-list-item-title>View details</v-list-item-title>
      </v-list-item>
      <v-list-item :disabled="props.readOnly === true" @click="emit('acmg-click', actionsRow)">
        <v-list-item-title>Classify ACMG</v-list-item-title>
      </v-list-item>
      <v-list-item :disabled="props.readOnly === true" @click="emit('comment-click', actionsRow)">
        <v-list-item-title>Edit comments</v-list-item-title>
      </v-list-item>
      <v-list-item @click="emit('open-in-tab', targetTabFor(actionsRow.variant_type))">
        <v-list-item-title>
          View in {{ targetTabFor(actionsRow.variant_type).toUpperCase() }} tab
        </v-list-item-title>
      </v-list-item>
      <ProteinViewMenuItem :variant="actionsRow" />
    </v-list>
  </v-menu>
  <v-tooltip
    v-if="rankTip.open.value"
    v-model="rankTip.open.value"
    :activator="rankTip.element.value ?? undefined"
    :open-on-hover="false"
    :open-on-focus="false"
    aria-label="Score breakdown"
    location="right"
  >
    <RankScoreTooltip
      v-if="rankTipRow"
      :score="rankTipRow.rank_score"
      :components="rankTipRow.rank_components"
      :pinned="pinFor(rankTipRow)"
      :evidence="rankTipRow.rank_evidence"
      :partners="rankTipRow.rank_partners"
      :phase="rankTipRow.rank_comphet_phase"
      :hpo="rankTipRow.rank_hpo"
    />
  </v-tooltip>

  <BulkTriageActionBar
    v-if="!props.readOnly"
    :selected-count="bulkSelection.selectedCount.value"
    :is-executing="bulkSelection.isExecuting.value"
    @apply="bulkSelection.applyBulkTriage"
    @clear="bulkSelection.clearSelection"
  />
</template>

<style scoped>
/*
 * Make the table fill whatever flex height its parent gives it. The panel
 * wrapper (ShortlistPanel.vue) provides the bounded-flex context; this
 * rule ensures the data-table stretches vertically and the body gets its
 * own scroll viewport so long result sets don't overflow the panel.
 */
.shortlist-data-table {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.shortlist-data-table :deep(.v-table__wrapper) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

/* Fixed layout: the header widths are the column widths, so a sort or a new
   case's rows can never re-flow the columns (same as the case/cohort tables). */
.shortlist-data-table :deep(.v-table__wrapper > table) {
  table-layout: fixed;
}

.shortlist-data-table :deep(.v-data-table-footer) {
  flex: 0 0 auto;
}

/* A long ClinVar class ends in an ellipsis inside the fixed column (the full
   value is in the chip's tooltip) instead of being clipped mid-word. */
.shortlist-data-table :deep(td .v-chip[data-tooltip]) {
  max-width: 100%;
}
.shortlist-data-table :deep(td .v-chip[data-tooltip] .v-chip__content) {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Same 18px glyph box the former x-small icon v-btn rendered */
.shortlist-row-icon {
  font-size: 18px;
}

.shortlist-data-table :deep(tbody tr) {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.shortlist-data-table :deep(tbody tr.variant-row--selected) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent) !important;
  font-weight: 500;
}

.shortlist-data-table :deep(tbody tr.variant-row--selected:hover) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent) !important;
}

.bulk-select-checkbox {
  cursor: pointer;
  accent-color: rgb(var(--v-theme-primary));
}
</style>
