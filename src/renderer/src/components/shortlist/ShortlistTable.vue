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

import { computed } from 'vue'
import { onKeyStroke } from '@vueuse/core'
import { mdiStar, mdiStarOutline, mdiDotsVertical } from '@mdi/js'
import RankScoreTooltip from './RankScoreTooltip.vue'
import { useRowHoverTarget } from './useRowHoverTarget'
import { CellChip, CellIcon } from '../table-cells/cell-components'
import { LinkOutsCell } from '../table-cells/simple-cells'
import { linksColumn } from '../variant-table/columns'
import { resolveRowLinks, useLinkResolvers } from '../../composables/useLinkResolvers'
import { useVariantLinks } from '../../composables/useVariantLinks'
import { useSharedMenu } from '../table-cells/shared-menu'
import { useResultSetKeys } from '../table-state/useResultSetKeys'
import {
  useTableKeyboardNav,
  isInputFocused,
  hasCommandModifier
} from '../../composables/useTableKeyboardNav'
import type { ShortlistRow } from '../../../../shared/types/shortlist'

const props = defineProps<{
  rows: ShortlistRow[]
}>()

const emit = defineEmits<{
  (e: 'row-click', row: ShortlistRow): void
  (e: 'open-in-tab', variantType: 'snv' | 'sv' | 'cnv' | 'str'): void
  (e: 'toggle-star', row: ShortlistRow): void
}>()

const baseHeaders = [
  { title: '#', key: 'rank', width: 60, sortable: false },
  { title: 'Score', key: 'rank_score', width: 90, sortable: false },
  { title: 'Type', key: 'variant_type', width: 80, sortable: false },
  { title: 'Gene', key: 'gene_symbol', width: 140 },
  { title: 'Variant', key: 'variant_notation', width: 280, sortable: false },
  { title: 'Impact', key: 'consequence', width: 110 },
  { title: 'AF', key: 'gnomad_af', width: 90 },
  { title: 'ClinVar', key: 'clinvar', width: 130 },
  { title: '★', key: 'is_starred', width: 50, sortable: false },
  { title: '', key: 'actions', width: 80, sortable: false }
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

interface VariantCell {
  /** Always present — genomic/type-specific primary line. */
  primary: string
  /** HGVS c. (cDNA) notation, SNV/indel only. */
  cdna: string | null
  /** HGVS p. (protein) notation, SNV/indel only. */
  protein: string | null
}

/**
 * Build the multi-line variant cell for the shortlist table.
 *
 * - SNV / indel: primary line is `chr:pos ref>alt`, with cDNA (c.) and
 *   protein (p.) HGVS on subsequent lines when available on the row.
 * - SV: primary line is `chr:pos <TYPE> <length>bp`, no HGVS.
 * - CNV: primary line is `chr:pos CNV CN=<copies>`, no HGVS.
 * - STR: primary line is `chr:pos STR <alt_copies> copies`, no HGVS.
 *
 * Fields `cdna` and `aa_change` come straight from the `Variant` row shape.
 * The `c.`/`p.` prefixes are conventional HGVS markers — we only prepend
 * them if the stored value doesn't already start with them (annotators
 * vary — VEP stores bare notation, SnpEff stores prefixed).
 */
function variantCell(row: ShortlistRow): VariantCell {
  if (row.variant_type === 'sv') {
    return {
      primary: `${row.chr}:${row.pos} ${row.sv_type ?? ''} ${row.sv_length ?? '?'}bp`.trim(),
      cdna: null,
      protein: null
    }
  }
  if (row.variant_type === 'cnv') {
    return {
      primary: `${row.chr}:${row.pos} CNV CN=${row.cnv_copy_number ?? '?'}`,
      cdna: null,
      protein: null
    }
  }
  if (row.variant_type === 'str') {
    return {
      primary: `${row.chr}:${row.pos} STR ${row.str_alt_copies ?? '?'} copies`,
      cdna: null,
      protein: null
    }
  }
  // SNV / indel — add HGVS c./p. if we have them.
  return {
    primary: `${row.chr}:${row.pos} ${row.ref}>${row.alt}`,
    cdna: row.cdna != null && row.cdna !== '' ? ensureHgvsPrefix(row.cdna, 'c.') : null,
    protein:
      row.aa_change != null && row.aa_change !== '' ? ensureHgvsPrefix(row.aa_change, 'p.') : null
  }
}

function ensureHgvsPrefix(value: string, prefix: 'c.' | 'p.'): string {
  return value.startsWith(prefix) ? value : `${prefix}${value}`
}

function pinFor(row: ShortlistRow): 'starred' | 'clinvar' | null {
  if (row.rank_starred_pinned) return 'starred'
  if (row.rank_clinvar_pinned) return 'clinvar'
  return null
}

function typeChipColor(t: ShortlistRow['variant_type']): string {
  // NEVER surface-variant (CLAUDE.md rule). Use explicit palette entries.
  switch (t) {
    case 'snv':
      return 'primary'
    case 'indel':
      return 'primary'
    case 'sv':
      return 'deep-purple'
    case 'cnv':
      return 'teal-darken-2'
    case 'str':
      return 'orange-darken-2'
    default:
      return 'primary'
  }
}

function targetTabFor(t: ShortlistRow['variant_type']): 'snv' | 'sv' | 'cnv' | 'str' {
  if (t === 'sv' || t === 'cnv' || t === 'str') return t
  // indel (and any unknown) folds into the SNV tab.
  return 'snv'
}

function displayVariantType(t: ShortlistRow['variant_type']): string {
  return (t ?? 'snv').toUpperCase()
}

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

function getRowProps({ item }: { item: ShortlistRow }) {
  const isSelected = selectedItem.value?.id === item.id
  return {
    class: {
      'variant-row--selected': isSelected
    }
  }
}

function handleRowClick(item: ShortlistRow) {
  selectByClick(item)
  emit('row-click', item)
}

onKeyStroke(
  'ArrowDown',
  (e: KeyboardEvent) => {
    if (isInputFocused() || props.rows.length === 0) return
    e.preventDefault()
    moveDown()
  },
  { dedupe: true }
)

onKeyStroke(
  'ArrowUp',
  (e: KeyboardEvent) => {
    if (isInputFocused() || props.rows.length === 0) return
    e.preventDefault()
    moveUp()
  },
  { dedupe: true }
)

onKeyStroke(
  'Enter',
  (e: KeyboardEvent) => {
    if (isInputFocused() || !selectedItem.value) return
    e.preventDefault()
    emit('row-click', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  's',
  (e: KeyboardEvent) => {
    if (hasCommandModifier(e) || isInputFocused() || !selectedItem.value) return
    e.preventDefault()
    emit('toggle-star', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'Escape',
  (e: KeyboardEvent) => {
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
    :items-per-page="50"
    :items-per-page-options="[25, 50, 100, 250, 500]"
    class="shortlist-data-table"
    :row-props="getRowProps"
    @click:row="(_: MouseEvent, { item }: { item: ShortlistRow }) => handleRowClick(item)"
    @mouseover="rankTip.onMouseover"
    @mouseout="rankTip.onMouseout"
  >
    <!-- Score breakdown: one shared tooltip (below), not a v-tooltip per row -->
    <template #[`item.rank_score`]="{ item }">
      <span :data-rank-tip="item.id">{{ item.rank_score.toFixed(2) }}</span>
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

    <template #[`item.gnomad_af`]="{ item }">
      {{ item.gnomad_af == null ? '—' : item.gnomad_af.toExponential(2) }}
    </template>

    <!-- Native buttons + static icons: no VBtn/VIcon instances per row -->
    <template #[`item.is_starred`]="{ item }">
      <button
        type="button"
        class="annotation-btn"
        :aria-label="item.is_starred ? 'Unstar variant' : 'Star variant'"
        :aria-pressed="item.is_starred"
        :data-testid="`shortlist-star-${item.id}`"
        @click.stop="emit('toggle-star', item)"
      >
        <CellIcon
          class="shortlist-row-icon"
          :color="item.is_starred ? 'primary' : null"
          :icon="item.is_starred ? mdiStar : mdiStarOutline"
        />
      </button>
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
      <v-list-item @click="emit('open-in-tab', targetTabFor(actionsRow.variant_type))">
        <v-list-item-title>
          View in {{ targetTabFor(actionsRow.variant_type).toUpperCase() }} tab
        </v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
  <v-tooltip
    v-model="rankTip.open.value"
    :activator="rankTip.element.value ?? undefined"
    :open-on-hover="false"
    :open-on-focus="false"
    location="right"
  >
    <RankScoreTooltip
      v-if="rankTipRow"
      :score="rankTipRow.rank_score"
      :components="rankTipRow.rank_components"
      :pinned="pinFor(rankTipRow)"
    />
  </v-tooltip>
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
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
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
</style>
