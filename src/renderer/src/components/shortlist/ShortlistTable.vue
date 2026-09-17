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
 * ★ / actions. `rank_score` is non-sortable (ranking is the feature);
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
import { useTableKeyboardNav, isInputFocused } from '../../composables/useTableKeyboardNav'
import type { ShortlistRow } from '../../../../shared/types/shortlist'

const props = defineProps<{
  rows: ShortlistRow[]
}>()

const emit = defineEmits<{
  (e: 'row-click', row: ShortlistRow): void
  (e: 'open-in-tab', variantType: 'snv' | 'sv' | 'cnv' | 'str'): void
  (e: 'toggle-star', row: ShortlistRow): void
}>()

const headers = [
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
    if (isInputFocused() || !selectedItem.value) return
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
    item-value="id"
    density="compact"
    :items-per-page="50"
    :items-per-page-options="[25, 50, 100, 250, 500]"
    class="shortlist-data-table"
    :row-props="getRowProps"
    @click:row="(_: MouseEvent, { item }: { item: ShortlistRow }) => handleRowClick(item)"
  >
    <template #[`item.rank_score`]="{ item }">
      <v-tooltip location="right">
        <template #activator="{ props: tipProps }">
          <span v-bind="tipProps">{{ item.rank_score.toFixed(2) }}</span>
        </template>
        <RankScoreTooltip
          :score="item.rank_score"
          :components="item.rank_components"
          :pinned="pinFor(item)"
        />
      </v-tooltip>
    </template>

    <template #[`item.variant_type`]="{ item }">
      <v-chip :color="typeChipColor(item.variant_type)" size="x-small" variant="flat">
        {{ displayVariantType(item.variant_type) }}
      </v-chip>
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

    <template #[`item.is_starred`]="{ item }">
      <v-btn
        icon
        variant="text"
        size="x-small"
        :data-testid="`shortlist-star-${item.id}`"
        @click.stop="emit('toggle-star', item)"
      >
        <v-icon
          :color="item.is_starred ? 'primary' : undefined"
          :icon="item.is_starred ? mdiStar : mdiStarOutline"
        />
      </v-btn>
    </template>

    <template #[`item.actions`]="{ item }">
      <v-menu>
        <template #activator="{ props: actProps }">
          <v-btn
            icon
            variant="text"
            size="x-small"
            :data-testid="`shortlist-actions-${item.id}`"
            v-bind="actProps"
          >
            <v-icon :icon="mdiDotsVertical" />
          </v-btn>
        </template>
        <v-list density="compact">
          <v-list-item @click="emit('row-click', item)">
            <v-list-item-title>View details</v-list-item-title>
          </v-list-item>
          <v-list-item @click="emit('open-in-tab', targetTabFor(item.variant_type))">
            <v-list-item-title>
              View in {{ targetTabFor(item.variant_type).toUpperCase() }} tab
            </v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </template>
  </v-data-table>
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
