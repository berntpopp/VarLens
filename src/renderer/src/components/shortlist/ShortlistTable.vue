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

import { computed, inject, onUnmounted } from 'vue'
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
import {
  variantCell,
  pinFor,
  typeChipColor,
  targetTabFor,
  displayVariantType
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
import {
  annotationCache,
  variantKey,
  ACMG_COLORS,
  ACMG_ABBREV
} from '../../composables/useAnnotations'
import { useBulkTriageSelection } from '../../composables/useBulkTriageSelection'
import BulkTriageActionBar from '../variant-table/BulkTriageActionBar.vue'

const props = defineProps<{
  rows: ShortlistRow[]
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

// Widths in rem so headers grow with the text size (no clipping at 200 %)
const baseHeaders = [
  { title: '#', key: 'rank', width: '3.75rem', sortable: false },
  { title: 'Score', key: 'rank_score', width: '5.625rem', sortable: false },
  { title: 'Type', key: 'variant_type', width: '5rem', sortable: false },
  { title: 'Gene', key: 'gene_symbol', width: '8.75rem' },
  { title: 'Variant', key: 'variant_notation', width: '17.5rem', sortable: false },
  { title: 'Impact', key: 'consequence', width: '6.875rem' },
  { title: 'AF', key: 'gnomad_af', width: '5.625rem' },
  { title: 'ClinVar', key: 'clinvar', width: '8.125rem' },
  { title: '★', key: 'is_starred', width: '6.5rem', sortable: false },
  { title: 'Actions', key: 'actions', width: '5rem', sortable: false }
] as const

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
const rowsRef = computed(() => props.rows)

const { selectedItem, selectByClick, moveUp, moveDown, clearSelection } = useTableKeyboardNav({
  items: rowsRef,
  getItemId: (item: ShortlistRow) => item.id,
  onSelect: (_item: ShortlistRow) => {}
})

useProteinViewShortcut(() => (props.interactive === false ? null : selectedItem.value))

function getRowProps({ item }: { item: ShortlistRow }) {
  const isSelected = selectedItem.value?.id === item.id
  return {
    class: {
      'variant-row--selected': isSelected
    }
  }
}

function getAcmgFor(item: ShortlistRow): AcmgClassification | null {
  const key = variantKey({ chr: item.chr, pos: item.pos, ref: item.ref, alt: item.alt })
  const cached = annotationCache.value.get(key)
  return cached?.perCase?.acmg_classification ?? cached?.global?.acmg_classification ?? null
}

function hasCommentFor(item: ShortlistRow): boolean {
  const key = variantKey({ chr: item.chr, pos: item.pos, ref: item.ref, alt: item.alt })
  const cached = annotationCache.value.get(key)
  const perCase = cached?.perCase?.per_case_comment
  const global = cached?.global?.global_comment
  return (
    (perCase !== undefined && perCase !== null && perCase !== '') ||
    (global !== undefined && global !== null && global !== '')
  )
}

const caseId = computed(() => props.rows[0]?.case_id ?? null)
const bulkSelection = useBulkTriageSelection({
  items: () => props.rows,
  getItemId: (r) => r.id,
  caseId,
  onTriageApplied: () => emit('triage-applied')
})

const appState = inject(AppStateKey, null)
let arrowSyncTimer: ReturnType<typeof setTimeout> | null = null

function triggerDebouncedPanelSync() {
  if (arrowSyncTimer !== null) {
    clearTimeout(arrowSyncTimer)
    arrowSyncTimer = null
  }
  if (appState?.panelOpen.value === true && selectedItem.value) {
    arrowSyncTimer = setTimeout(() => {
      arrowSyncTimer = null
      if (appState?.panelOpen.value === true && selectedItem.value) {
        emit('row-click', selectedItem.value)
      }
    }, 100)
  }
}

onUnmounted(() => {
  if (arrowSyncTimer !== null) {
    clearTimeout(arrowSyncTimer)
    arrowSyncTimer = null
  }
})

function handleRowClick(item: ShortlistRow) {
  if (arrowSyncTimer !== null) {
    clearTimeout(arrowSyncTimer)
    arrowSyncTimer = null
  }
  selectByClick(item)
  emit('row-click', item)
}

onKeyStroke(
  'ArrowDown',
  (e: KeyboardEvent) => {
    if (props.interactive === false) return
    if (isInputFocused() || props.rows.length === 0) return
    e.preventDefault()
    moveDown()
    triggerDebouncedPanelSync()
  },
  { dedupe: true }
)

onKeyStroke(
  'ArrowUp',
  (e: KeyboardEvent) => {
    if (props.interactive === false) return
    if (isInputFocused() || props.rows.length === 0) return
    e.preventDefault()
    moveUp()
    triggerDebouncedPanelSync()
  },
  { dedupe: true }
)

onKeyStroke(
  ['Enter', 'i'],
  (e: KeyboardEvent) => {
    if (props.interactive === false) return
    if (isInputFocused() || isControlFocused() || !selectedItem.value) return
    e.preventDefault()
    emit('row-click', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  's',
  (e: KeyboardEvent) => {
    if (props.interactive === false) return
    if (hasCommandModifier(e) || isInputFocused() || !selectedItem.value) return
    if (props.readOnly === true) return
    e.preventDefault()
    emit('toggle-star', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'a',
  (e: KeyboardEvent) => {
    if (props.interactive === false) return
    if (hasCommandModifier(e) || isInputFocused() || !selectedItem.value) return
    if (props.readOnly === true) return
    e.preventDefault()
    emit('acmg-click', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'c',
  (e: KeyboardEvent) => {
    if (props.interactive === false) return
    if (hasCommandModifier(e) || isInputFocused() || !selectedItem.value) return
    if (props.readOnly === true) return
    e.preventDefault()
    emit('comment-click', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'Escape',
  (e: KeyboardEvent) => {
    if (props.interactive === false) return
    if (isInputFocused()) return
    e.preventDefault()
    clearSelection()
  },
  { dedupe: true }
)
</script>

<template>
  <v-data-table
    :headers="headers"
    :items="props.rows"
    :item-value="rowKey"
    density="compact"
    show-select
    :items-per-page="50"
    :items-per-page-options="[25, 50, 100, 250, 500]"
    class="shortlist-data-table"
    :row-props="getRowProps"
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
      <div class="variant-cell">
        <div class="variant-cell__primary">{{ variantCell(item).primary }}</div>
        <div
          v-if="variantCell(item).cdna"
          class="variant-cell__hgvs text-caption text-medium-emphasis"
          :title="variantCell(item).cdna ?? ''"
        >
          {{ variantCell(item).cdna }}
        </div>
        <div
          v-if="variantCell(item).protein"
          class="variant-cell__hgvs text-caption text-medium-emphasis"
          :title="variantCell(item).protein ?? ''"
        >
          {{ variantCell(item).protein }}
        </div>
      </div>
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
          :aria-label="item.is_starred ? 'Unstar variant' : 'Star variant'"
          :aria-pressed="item.is_starred"
          :data-testid="`shortlist-star-${item.id}`"
          :disabled="props.readOnly === true"
          @click.stop="emit('toggle-star', item)"
        >
          <CellIcon
            class="shortlist-row-icon"
            :color="item.is_starred ? 'primary' : null"
            :icon="item.is_starred ? mdiStar : mdiStarOutline"
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
      <v-list-item @click="emit('acmg-click', actionsRow)">
        <v-list-item-title>Classify ACMG</v-list-item-title>
      </v-list-item>
      <v-list-item @click="emit('comment-click', actionsRow)">
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

/*
 * Multi-line variant cell — primary line (genomic) + optional HGVS c./p.
 * lines in muted caption text. `min-width: 0` lets truncation kick in
 * inside the fixed-width column. HGVS strings can be long for multi-
 * exon indels; we clip with ellipsis and put the full value in a title
 * attribute for hover.
 */
.variant-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
  padding: 2px 0;
}
.variant-cell__primary {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.variant-cell__hgvs {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
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
