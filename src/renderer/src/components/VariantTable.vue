<template>
  <div class="table-container">
    <!-- Top scrollbar (synced with table) -->
    <div ref="topScrollbarRef" class="top-scrollbar-container">
      <div ref="topScrollbarInnerRef" class="top-scrollbar-inner"></div>
    </div>

    <v-data-table-server
      ref="dataTableRef"
      v-model:page="page"
      v-model:items-per-page="itemsPerPage"
      v-model:sort-by="sortBy"
      :headers="visibleHeaders"
      :items="variants"
      :items-length="totalCount"
      :loading="loading"
      :items-per-page-options="itemsPerPageOptions"
      density="compact"
      multi-sort
      class="elevation-1"
      :row-props="getRowProps"
      @update:options="loadVariants"
      @click:row="handleRowClick"
    >
      <!-- Custom header slots with per-column filter icons -->
      <template
        v-for="col in filterableColumns"
        :key="`header-${col.key}`"
        #[`header.${col.key}`]="{
          column: headerColumn,
          getSortIcon,
          toggleSort,
          isSorted,
          sortBy: slotSortBy
        }"
      >
        <VariantColumnHeader
          :header-column="headerColumn"
          :get-sort-icon="getSortIcon"
          :toggle-sort="toggleSort"
          :is-sorted="isSorted"
          :sort-by="slotSortBy"
          :has-filter="hasFilter(col.key)"
          :current-filter="getFilter(col.key)"
          :column-meta="columnMetaMap[col.key]"
          :filter-mode="columnFilterModes[col.key] ?? 'text-suggest'"
          @apply-filter="(f) => setColumnFilter(col.key, f)"
          @clear-filter="clearColumnFilter(col.key)"
        />
      </template>

      <!-- Annotations column (star, ACMG, comment) -->
      <template #[`item.annotations`]="{ item }">
        <AnnotationsCell
          :is-starred="isStarred(item.chr, item.pos, item.ref, item.alt)"
          :is-global-starred="isGlobalStarred(item.chr, item.pos, item.ref, item.alt)"
          :acmg-classification="getAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
          :global-acmg-classification="
            getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)
          "
          :has-comment="!!getPerCaseComment(item.chr, item.pos, item.ref, item.alt)"
          :has-global-comment="!!getGlobalComment(item.chr, item.pos, item.ref, item.alt)"
          :show-global-indicators="true"
          :annotation-scope="annotationScope"
          @star-toggle="annotationDialogsRef?.handleStarToggle(item)"
          @acmg-select="(c) => annotationDialogsRef?.handleQuickAcmgSelect(item, c)"
          @acmg-evidence-click="annotationDialogsRef?.openAcmgEvidenceDialog(item)"
          @comment-click="annotationDialogsRef?.openCommentDialog(item)"
        />
      </template>

      <!-- Chromosome with dynamic link from store -->
      <template #[`item.chr`]="{ item, value }">
        <ExternalLinkCell
          v-if="getLinkForColumn('chr') && resolveLink(getLinkForColumn('chr')!.id, item)"
          :url="resolveLink(getLinkForColumn('chr')!.id, item)!"
          :label="value"
          @click="openExternalLink"
        />
        <span v-else>{{ value }}</span>
      </template>

      <!-- Position with thousand separators and dynamic link from store -->
      <template #[`item.pos`]="{ item, value }">
        <PositionCell
          :position="value"
          :url="
            getLinkForColumn('pos') && resolveLink(getLinkForColumn('pos')!.id, item)
              ? resolveLink(getLinkForColumn('pos')!.id, item)!
              : null
          "
          @click="openExternalLink"
        />
      </template>

      <!-- gnomAD AF in scientific notation -->
      <template #[`item.gnomad_af`]="{ value }">
        <FrequencyCell :frequency="value" />
      </template>

      <!-- ClinVar colored chips with dynamic link from store -->
      <template #[`item.clinvar`]="{ item, value }">
        <ClinVarCell
          :significance="value"
          :url="
            value &&
            getLinkForColumn('clinvar') &&
            resolveLink(getLinkForColumn('clinvar')!.id, item)
              ? resolveLink(getLinkForColumn('clinvar')!.id, item)!
              : null
          "
          @click="openExternalLink"
        />
      </template>

      <!-- Ref allele with truncation and tooltip -->
      <template #[`item.ref`]="{ value }">
        <AlleleCell :allele="value" />
      </template>

      <!-- Alt allele with truncation and tooltip -->
      <template #[`item.alt`]="{ value }">
        <AlleleCell :allele="value" />
      </template>

      <!-- CADD score (handle null) -->
      <template #[`item.cadd`]="{ value }">
        <CaddScoreCell :score="value" />
      </template>

      <!-- Gene symbol with dynamic link from store -->
      <template #[`item.gene_symbol`]="{ item, value }">
        <GeneSymbolCell
          :value="value"
          :link-url="
            value &&
            getLinkForColumn('gene_symbol') &&
            resolveLink(getLinkForColumn('gene_symbol')!.id, item)
              ? resolveLink(getLinkForColumn('gene_symbol')!.id, item)!
              : null
          "
          @click="openExternalLink"
        />
      </template>

      <!-- OMIM MIM number with clickable link to OMIM entry -->
      <template #[`item.omim_mim_number`]="{ value }">
        <ExternalLinkCell
          v-if="value && buildOmimEntryUrl(value)"
          :url="buildOmimEntryUrl(value)!"
          :label="value"
          @click="openExternalLink"
        />
        <EmptyPlaceholder v-else />
      </template>

      <!-- Consequence (handle null) -->
      <template #[`item.consequence`]="{ value }">
        <ConsequenceCell :consequence="value" />
      </template>

      <!-- GT (handle null) -->
      <template #[`item.gt_num`]="{ value }">
        <template v-if="value !== null && value !== undefined">{{ value }}</template>
        <EmptyPlaceholder v-else />
      </template>

      <!-- Func (handle null) with human-readable formatting -->
      <template #[`item.func`]="{ value }">
        <v-tooltip v-if="value" location="top">
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps" class="consequence-cell">
              {{ formatConsequence(value) }}
            </span>
          </template>
          <span class="text-body-small">{{ value }}</span>
        </v-tooltip>
        <EmptyPlaceholder v-else />
      </template>

      <!-- Qual score (handle null/undefined/non-number) -->
      <template #[`item.qual`]="{ value }">
        <template v-if="value !== null && value !== undefined && typeof value === 'number'">{{
          value.toFixed(1)
        }}</template>
        <EmptyPlaceholder v-else />
      </template>

      <!-- Transcript (handle null, truncate long IDs) -->
      <template #[`item.transcript`]="{ value }">
        <v-tooltip v-if="value" location="top">
          <template #activator="{ props: tipProps }">
            <span v-bind="tipProps" class="variant-data-mono transcript-truncated">{{
              value
            }}</span>
          </template>
          {{ value }}
        </v-tooltip>
        <EmptyPlaceholder v-else />
      </template>

      <!-- cDNA (handle null) -->
      <template #[`item.cdna`]="{ value }">
        <span v-if="value" class="hgvs-notation">{{ value }}</span>
        <EmptyPlaceholder v-else />
      </template>

      <!-- AA Change (handle null) -->
      <template #[`item.aa_change`]="{ value }">
        <span v-if="value" class="hgvs-notation">{{ value }}</span>
        <EmptyPlaceholder v-else />
      </template>

      <!-- HPO Sim Score (handle null/undefined/non-number) -->
      <template #[`item.hpo_sim_score`]="{ value }">
        <template v-if="value !== null && value !== undefined && typeof value === 'number'">{{
          value.toFixed(2)
        }}</template>
        <EmptyPlaceholder v-else />
      </template>

      <!-- MoI (handle null) -->
      <template #[`item.moi`]="{ value }">
        <template v-if="value !== null && value !== undefined">{{ value }}</template>
        <EmptyPlaceholder v-else />
      </template>

      <!-- Dynamic virtual link columns from store -->
      <template
        v-for="link in linksStore.virtualLinks"
        :key="link.id"
        #[`item._link_${link.id}`]="{ item }"
      >
        <ExternalLinkCell
          v-if="resolveLink(link.id, item)"
          :url="resolveLink(link.id, item)!"
          label="View"
          @click="openExternalLink"
        />
        <span v-else class="text-grey">--</span>
      </template>

      <!-- Loading skeleton: shown inside the table body to prevent layout shift -->
      <template #loading>
        <v-skeleton-loader type="table-row@10" class="variant-table-skeleton" />
      </template>

      <!-- Empty state when filters produce no results -->
      <template #no-data>
        <div
          class="text-center pa-8"
          role="status"
          aria-label="No variants match the current filters"
        >
          <v-icon size="48" color="grey-lighten-1" class="mb-4" :icon="mdiFilterOffOutline" />
          <div class="text-h6 text-medium-emphasis mb-2">No variants match your filters</div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            Try adjusting your filter criteria or clearing all filters.
          </div>
          <v-btn variant="tonal" color="primary" size="small" @click="emit('clear-filters')">
            <v-icon start size="small" :icon="mdiFilterOff" />
            Clear filters
          </v-btn>
        </div>
      </template>
    </v-data-table-server>

    <AnnotationDialogs
      ref="annotationDialogsRef"
      :case-id="caseId"
      :annotation-scope="annotationScope"
      :annotation-actions="annotationActions"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRef, watch, onMounted, onActivated, onDeactivated, nextTick } from 'vue'
import type { Variant, VariantFilter } from '../../../shared/types/api'
import type { AnnotationScope } from '../../../shared/types/annotations'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import type { ActiveFilter } from '../../../shared/types/filters'
import { buildActiveFiltersList } from '../utils/filters/activeFilters'
import { useColumnFilterMeta } from '../composables/useColumnFilterMeta'
import { useAnnotations } from '../composables/useAnnotations'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useVariantLinks } from '../composables/useVariantLinks'
import { formatConsequence } from '../utils/formatters'
import { useTableScroll } from '../composables/useTableScroll'
import { useTableKeyboardNav } from '../composables/useTableKeyboardNav'
import { onKeyStroke } from '@vueuse/core'
import VariantColumnHeader from './variant-table/VariantColumnHeader.vue'
import AnnotationDialogs from './AnnotationDialogs.vue'
import { useVariantColumns } from './variant-table/columns'
import { useVariantData } from './variant-table/useVariantData'
import { mdiFilterOff, mdiFilterOffOutline } from '@mdi/js'
import {
  PositionCell,
  AlleleCell,
  ClinVarCell,
  FrequencyCell,
  CaddScoreCell,
  GeneSymbolCell,
  ConsequenceCell,
  ExternalLinkCell,
  AnnotationsCell,
  EmptyPlaceholder
} from './table-cells'

interface Props {
  caseId: number
  filters: Omit<VariantFilter, 'case_id'>
  annotationScope?: AnnotationScope
  /** Per-column metadata from useFilterState (avoids duplicate IPC call) */
  columnMeta?: ColumnFilterMeta[]
}

const props = withDefaults(defineProps<Props>(), {
  annotationScope: 'case',
  columnMeta: () => []
})

const emit = defineEmits<{
  'update:counts': [counts: { filtered: number; total: number }]
  'update:hasSort': [hasSort: boolean]
  'row-click': [variant: Variant]
  deselect: []
  'clear-filters': []
}>()

// Annotations
const {
  isStarred,
  isGlobalStarred,
  getAcmgClassification,
  getGlobalAcmgClassification,
  getAcmgEvidence,
  toggleStar,
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  getGlobalComment,
  getPerCaseComment,
  upsertGlobalComment,
  upsertPerCaseComment,
  getAnnotations,
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  getGlobalAcmgEvidence
} = useAnnotations()

// Bundle annotation actions for dialog subcomponent
const annotationActions = {
  getAcmgEvidence,
  toggleStar,
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  upsertGlobalComment,
  upsertPerCaseComment,
  getAnnotations,
  getGlobalComment,
  getPerCaseComment,
  toggleGlobalStar,
  setGlobalAcmgClassification,
  setGlobalAcmgClassificationWithEvidence,
  getGlobalAcmgEvidence
}

// Links
const { linksStore, buildOmimEntryUrl, resolveLink, getLinkForColumn, openExternalLink } =
  useVariantLinks()

// Column preferences and column definitions
const { prefs } = useColumnPreferences('variant-table')
const { headers, visibleHeaders, filterableColumns } = useVariantColumns(prefs)

// Data loading and state
const {
  variants,
  totalCount,
  loading,
  page,
  itemsPerPage,
  sortBy,
  itemsPerPageOptions,
  selectedVariantId,
  loadVariants,
  resetSort,
  getRowProps,
  columnMeta,
  hasActiveFilters: hasColumnFilters,
  activeFilterCount: columnFilterCount,
  setColumnFilter,
  clearColumnFilter,
  clearAllColumnFilters,
  hasFilter,
  getFilter,
  getColumnFiltersParam
} = useVariantData({
  caseId: toRef(props, 'caseId'),
  filters: toRef(props, 'filters'),
  columnMeta: computed(() => props.columnMeta ?? []),
  onCountsUpdate: (counts) => emit('update:counts', counts),
  onSortUpdate: (hasSort) => emit('update:hasSort', hasSort)
})

// Column metadata map + filter modes (shared composable)
const { columnMetaMap, columnFilterModes } = useColumnFilterMeta(columnMeta)

// Column active filter chips for the toolbar
const columnActiveFilters = computed<ActiveFilter[]>(() => {
  const colFilters = getColumnFiltersParam()
  if (!colFilters) return []
  return buildActiveFiltersList(
    {
      searchQuery: '',
      geneSymbol: '',
      consequences: [],
      funcs: [],
      clinvars: [],
      maxGnomadAf: null,
      minCadd: null,
      maxInternalAf: null,
      minCarriers: null,
      starredOnly: false,
      hasCommentOnly: false,
      acmgClassifications: [],
      activePanelIds: [],
      panelPaddingBp: 5000,
      inheritanceModes: [],
      analysisGroupId: null,
      considerPhasing: false
    },
    [],
    colFilters
  ).filter((f) => f.id.startsWith('col:'))
})

// Template refs
const annotationDialogsRef = ref<InstanceType<typeof AnnotationDialogs> | null>(null)

// @ts-expect-error - These refs ARE used in template bindings
const { topScrollbarRef, topScrollbarInnerRef, initScrollSync } = useTableScroll()

const dataTableRef = ref<InstanceType<typeof import('vuetify/components').VDataTableServer> | null>(
  null
)

// Keyboard navigation
const {
  selectedIndex,
  selectedItem,
  selectByClick,
  moveUp,
  moveDown,
  clearSelection,
  isInputFocused
} = useTableKeyboardNav({
  items: variants,
  getItemId: (item: Variant) => item.id,
  onSelect: (item: Variant) => {
    selectedVariantId.value = item.id
  }
})

// Row click handler
const handleRowClick = (_event: unknown, { item }: { item: Variant }): void => {
  selectByClick(item)
  selectedVariantId.value = item.id
  emit('row-click', item)
}

// KeepAlive: disable keyboard handlers when this view is cached but not active
const viewActive = ref(true)
onActivated(() => {
  viewActive.value = true
})
onDeactivated(() => {
  viewActive.value = false
})

// Keyboard navigation handlers
onKeyStroke(
  'ArrowDown',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    e.preventDefault()
    moveDown()
  },
  { dedupe: true }
)

onKeyStroke(
  'ArrowUp',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    e.preventDefault()
    moveUp()
  },
  { dedupe: true }
)

onKeyStroke(
  'Enter',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    if (selectedItem.value === null) return
    e.preventDefault()
    emit('row-click', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'Escape',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    e.preventDefault()
    clearSelection()
    selectedVariantId.value = null
    emit('deselect')
  },
  { dedupe: true }
)

// Action shortcuts on selected row
onKeyStroke(
  's',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    if (selectedItem.value === null) return
    e.preventDefault()
    annotationDialogsRef.value?.handleStarToggle(selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'c',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    if (selectedItem.value === null) return
    e.preventDefault()
    annotationDialogsRef.value?.openCommentDialog(selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'a',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    if (selectedItem.value === null) return
    e.preventDefault()
    annotationDialogsRef.value?.openAcmgEvidenceDialog(selectedItem.value)
  },
  { dedupe: true }
)

// Scroll selected row into view
watch(selectedIndex, async (newIndex) => {
  if (newIndex === null) return
  await nextTick()
  const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
  if (!tableEl) return
  const rows = tableEl.querySelectorAll('tbody tr')
  const row = rows[newIndex] as HTMLElement | undefined
  row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

// Setup scroll sync after mount
onMounted(async () => {
  await nextTick()
  const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
  if (tableEl) {
    const tableWrapperEl = tableEl.querySelector('.v-table__wrapper') as HTMLElement | null
    if (tableWrapperEl) {
      initScrollSync(tableWrapperEl)
    }
  }
})

// Expose for parent components
defineExpose({
  resetSort,
  refresh: loadVariants,
  columns: computed(() => headers.value.map((h) => ({ key: h.key, title: h.title }))),
  hasColumnFilters,
  columnFilterCount,
  clearAllColumnFilters,
  clearColumnFilter,
  columnActiveFilters
})
</script>

<style src="./data-table-shared.css"></style>
<style scoped>
/* Loading skeleton (VariantTable-specific) */
.variant-table-skeleton {
  padding: 16px;
}

.variant-table-skeleton :deep(.v-skeleton-loader__bone) {
  margin-bottom: 8px;
}

/* Monospace data display */
.variant-data-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

/* Transcript column truncation */
.transcript-truncated {
  max-width: 120px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}
</style>
