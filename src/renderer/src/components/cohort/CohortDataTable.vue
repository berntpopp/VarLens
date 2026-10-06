<template>
  <div ref="tableContainerRef" class="table-container">
    <!-- Top scrollbar (synced with table) -->
    <div ref="topScrollbarRef" class="top-scrollbar-container">
      <div ref="topScrollbarInnerRef" class="top-scrollbar-inner"></div>
    </div>

    <TableLoadIndicator :active="showStale" :message="liveMessage" />
    <v-data-table-server
      ref="dataTableRef"
      v-model:page="page"
      v-model:items-per-page="tableItemsPerPage"
      v-model:sort-by="sortBy"
      v-model:expanded="expandedKeys"
      :headers="headers"
      :items="renderRows"
      :items-length="totalCount"
      :loading="firstLoad"
      :items-per-page-options="pageSizeOptions"
      :aria-busy="ariaBusy"
      :item-value="rowKey"
      density="compact"
      fixed-header
      show-expand
      class="elevation-1"
      :class="{ 'table--stale': showStale }"
      :row-props="getRowProps"
      @update:options="handleTableOptions"
      @click:row="handleRowClick"
    >
      <!-- Custom header slots with per-column filter icons (shared component) -->
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
          :has-filter="hasColumnFilter(col.key)"
          :current-filter="getColumnFilter(col.key)"
          :column-meta="columnMetaMap[col.key]"
          :filter-mode="columnFilterModes[col.key] ?? 'text-suggest'"
          @apply-filter="(f: ColumnFilter) => setColumnFilter(col.key, f)"
          @clear-filter="clearColumnFilter(col.key)"
        />
      </template>

      <template #[`header.annotations`]><AnnotationsHeader /></template>
      <template #[`header.data-table-expand`]><ExpandToggleCell header /></template>
      <template #[`item.data-table-expand`]="slot"><ExpandToggleCell v-bind="slot" /></template>
      <!-- Annotations column (star, ACMG, comment) -->
      <template #[`item.annotations`]="{ item }">
        <AnnotationsCell
          :is-starred="isGlobalStarred(item.chr, item.pos, item.ref, item.alt)"
          :acmg-classification="getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
          :has-comment="!!getGlobalComment(item.chr, item.pos, item.ref, item.alt)"
          :show-global-indicators="false"
          @star-toggle="emit('star-toggle', item)"
          @acmg-select="(classification) => emit('acmg-select', { item, classification })"
          @acmg-evidence-click="emit('acmg-evidence-click', item)"
          @comment-click="emit('comment-click', item)"
        />
      </template>

      <!-- Chromosome with dynamic link from store -->
      <template #[`item.chr`]="{ item, value }">
        <ExternalLinkCell
          v-if="item.render.links.chr"
          :url="item.render.links.chr"
          :label="value"
          @click="openExternalLink"
        />
        <span v-else>{{ value }}</span>
      </template>

      <!-- Position with thousand separators and dynamic link from store -->
      <template #[`item.pos`]="{ item, value }">
        <PositionCell
          :position="value"
          :url="item.render.links.pos ?? null"
          @click="openExternalLink"
        />
      </template>

      <template #[`item.ref`]="{ value }">
        <AlleleCell :allele="value" />
      </template>

      <template #[`item.alt`]="{ value }">
        <AlleleCell :allele="value" />
      </template>

      <!-- Gene symbol with dynamic link from store -->
      <template #[`item.gene_symbol`]="{ item, value }">
        <GeneSymbolCell
          :value="value"
          :link-url="value ? (item.render.links.gene_symbol ?? null) : null"
          @click="openExternalLink"
        />
      </template>

      <template #[`item.cdna`]="{ value }">
        <span class="hgvs-notation">{{ value ?? '--' }}</span>
      </template>

      <template #[`item.aa_change`]="{ value }">
        <span class="hgvs-notation">{{ value ?? '--' }}</span>
      </template>

      <template #[`item.consequence`]="{ value }">
        <ConsequenceCell :consequence="value" />
      </template>

      <!-- Functional consequence -->
      <template #[`item.func`]="{ value }">
        <span class="consequence-cell">{{ value ?? '--' }}</span>
      </template>

      <!-- ClinVar with dynamic link from store -->
      <template #[`item.clinvar`]="{ item, value }">
        <ClinVarCell
          :significance="value"
          :url="value ? (item.render.links.clinvar ?? null) : null"
          @click="openExternalLink"
        />
      </template>

      <!-- gnomAD allele frequency -->
      <template #[`item.gnomad_af`]="{ value }">
        <FrequencyCell :frequency="value" />
      </template>

      <!-- CADD phred score -->
      <template #[`item.cadd_phred`]="{ value }">
        <CaddScoreCell :score="value" />
      </template>

      <template #[`item.carrier_count`]="{ item }">
        {{ item.carrier_count ?? 0 }}
      </template>

      <template #[`item.cohort_frequency`]="{ value }">
        {{ value !== null && value !== undefined ? (value * 100).toFixed(2) + '%' : '--' }}
      </template>

      <!-- Het / Hom combined column -->
      <template #[`item.het_count`]="{ item }">
        {{ item.het_count ?? 0 }} / {{ item.hom_count ?? 0 }}
      </template>

      <!-- Merged Links column: one icon link per configured link-out -->
      <template #[`item._links`]="{ item }">
        <LinkOutsCell :links="linkOuts" :urls="item.render.links" @click="openExternalLink" />
      </template>

      <template #loading>
        <TableSkeletonRows :rows="Math.min(itemsPerPage, 15)" />
      </template>

      <!-- Expandable row with carrier details -->
      <template #expanded-row="{ columns, item }">
        <CarrierExpandedRow
          :carriers="getCarriers(item.variant_key) ?? []"
          :colspan="columns.length"
          @navigate-to-case="(caseId) => emit('navigate-to-case', { caseId, item })"
        />
      </template>
    </v-data-table-server>
    <AcmgQuickMenu :state="acmgQuickMenu" />
  </div>
</template>

<script setup lang="ts">
import { ref, toRef, watch, computed, onMounted, onActivated, onDeactivated, nextTick } from 'vue'
import { useTableKeyboardNav, hasCommandModifier } from '../../composables/useTableKeyboardNav'
import { onKeyStroke } from '@vueuse/core'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { AcmgClassification } from '../../../../shared/config/domain.config'
import type { SortItem } from '../../composables/useOffsetPagination'
import { useTableScroll } from '../../composables/useTableScroll'
import { useTableRowProps } from '../../composables/useTableRowProps'
import { useCarriers } from '../../composables/useCarriers'
import { useCohortRenderRows } from './useCohortRenderRows'
import {
  PositionCell,
  AlleleCell,
  ClinVarCell,
  FrequencyCell,
  CaddScoreCell,
  GeneSymbolCell,
  ConsequenceCell,
  AnnotationsCell,
  AnnotationsHeader,
  ExpandToggleCell,
  ExternalLinkCell,
  LinkOutsCell
} from '../table-cells'
import CarrierExpandedRow from './CarrierExpandedRow.vue'
import AcmgQuickMenu from '../table-cells/AcmgQuickMenu.vue'
import { provideAcmgQuickMenu } from '../table-cells/acmg-quick-menu'
import { useResultSetKeys } from '../table-state/useResultSetKeys'
import TableLoadIndicator from '../table-state/TableLoadIndicator.vue'
import TableSkeletonRows from '../table-state/TableSkeletonRows.vue'
import { useTableLoadingState } from '../../composables/useTableLoadingState'
import VariantColumnHeader from '../variant-table/VariantColumnHeader.vue'
import { useColumnFilters } from '../../composables/useColumnFilters'
import { useColumnFilterMeta } from '../../composables/useColumnFilterMeta'
import type {
  ColumnFilter,
  ColumnFilterMeta,
  ColumnFiltersParam
} from '../../../../shared/types/column-filters'
import type { ActiveFilter } from '../../../../shared/types/filters'
import { buildActiveFiltersList } from '../../utils/filters/activeFilters'
import { useDebounce } from '../../composables/useDebounce'
import { useLinkResolvers } from '../../composables/useLinkResolvers'
import { useAutoPageSize } from '../../composables/useAutoPageSize'
import { useVariantLinks } from '../../composables/useVariantLinks'
import { APP_CONFIG } from '../../../../shared/config'
import { LINKS_COLUMN_KEY } from '../../utils/link-outs'
import { getAdaptiveRowScrollBehavior } from '../../utils/adaptiveRowScroll'

interface Props {
  variants: CohortVariant[]
  totalCount: number
  loading: boolean
  headers: Array<{
    key: string
    title: string
    sortable?: boolean
    width?: string
    align?: 'start' | 'center' | 'end'
  }>
  selectedVariantKey: string | null
  /** Per-column metadata for filter UI auto-detection (optional, defaults to text-suggest) */
  columnMeta?: ColumnFilterMeta[]
  // Annotation lookup functions passed from parent
  isGlobalStarred: (chr: string, pos: number, ref: string, alt: string) => boolean
  getGlobalAcmgClassification: (
    chr: string,
    pos: number,
    ref: string,
    alt: string
  ) => AcmgClassification | null
  getGlobalComment: (chr: string, pos: number, ref: string, alt: string) => string | null
}

const emit = defineEmits<{
  'update:options': [options: unknown]
  'row-click': [variant: CohortVariant]
  'star-toggle': [item: CohortVariant]
  'acmg-select': [payload: { item: CohortVariant; classification: AcmgClassification | null }]
  'acmg-evidence-click': [item: CohortVariant]
  'comment-click': [item: CohortVariant]
  'navigate-to-case': [payload: { caseId: number; item: CohortVariant }]
  'load-carriers': [variant: CohortVariant]
  'column-filters-change': [filters: ColumnFiltersParam | undefined]
  deselect: []
}>()

// v-model props for pagination state (controlled by parent via useOffsetPagination)
const page = defineModel<number>('page', { default: 1 })
const itemsPerPage = defineModel<number>('itemsPerPage', { default: 10 })
const sortBy = defineModel<SortItem[]>('sortBy', { default: () => [] })

const props = defineProps<Props>()

// Page size incl. "Auto (fit)" (parity with the case table)
const tableContainerRef = ref<HTMLElement | null>(null)
const { tableItemsPerPage, pageSizeOptions } = useAutoPageSize({
  itemsPerPage,
  page,
  fixedOptions: APP_CONFIG.ITEMS_PER_PAGE_OPTIONS,
  container: tableContainerRef,
  rowCount: computed(() => props.variants.length)
})

const acmgQuickMenu = provideAcmgQuickMenu() // one shared ACMG menu, not one per row
// Template refs (used in template via ref="...")
// @ts-expect-error - These refs ARE used in template bindings
const { topScrollbarRef, topScrollbarInnerRef, initScrollSync } = useTableScroll()
const { getRowProps } = useTableRowProps<CohortVariant>({
  selectedId: ref(props.selectedVariantKey),
  getItemId: (item: CohortVariant) => item.variant_key
})
const { expandedRows, getCarriers, hasCarriers, clearCache: clearCarrierCache } = useCarriers()
// Fresh <tr>s per result set (moved rows are layout shifts); expanded stays by variant_key
const { rowKey, keyedModel } = useResultSetKeys(() => props.variants, 'variant_key')
const expandedKeys = keyedModel(expandedRows)

// Keyboard navigation
const {
  selectedIndex,
  selectedItem: navSelectedItem,
  selectByClick,
  moveUp,
  moveDown,
  clearSelection,
  isInputFocused
} = useTableKeyboardNav({
  items: computed(() => props.variants),
  getItemId: (item: CohortVariant) => item.variant_key,
  onSelect: () => {
    // onSelect intentionally empty: row-click is emitted by mouse + Enter handlers.
  }
})

// Per-column text filters
const {
  setColumnFilter,
  clearColumnFilter,
  clearAllColumnFilters,
  hasActiveFilters: hasColumnFilters,
  activeFilterCount: columnFilterCount,
  hasFilter: hasColumnFilter,
  getFilter: getColumnFilter,
  getColumnFiltersParam
} = useColumnFilters()

// Filterable columns: sortable data columns (exclude annotations, actions, expand columns)
const filterableColumns = computed(() =>
  props.headers.filter(
    (h) =>
      h.sortable !== false &&
      h.key !== LINKS_COLUMN_KEY &&
      h.key !== 'annotations' &&
      h.key !== 'data-table-expand'
  )
)

// Column metadata map + filter modes (shared composable)
const columnMetaRef = computed<ColumnFilterMeta[]>(() => props.columnMeta ?? [])
const { columnMetaMap, columnFilterModes } = useColumnFilterMeta(columnMetaRef)

// Debounced emit when column filters change
const { debouncedFn: debouncedEmitColumnFilters } = useDebounce(
  (newFilters: ColumnFiltersParam | undefined) => {
    emit('column-filters-change', newFilters)
  },
  300
)
watch(getColumnFiltersParam, (newFilters) => {
  debouncedEmitColumnFilters(newFilters)
})

// Loading presentation (shared with the case VariantTable): skeleton on first
// load only, dimmed rows + thin bar on refetch, polite result-count announcement
const { firstLoad, showStale, ariaBusy, liveMessage } = useTableLoadingState({
  loading: toRef(props, 'loading'),
  totalCount: toRef(props, 'totalCount')
})

// Link resolvers shared with the case table (incl. the merged Links column)
const { resolvers: linkConfig, linkOuts } = useLinkResolvers()
const { renderRows } = useCohortRenderRows(
  computed(() => props.variants),
  linkConfig
)
const { openExternalLink } = useVariantLinks()

// Table state
const dataTableRef = ref<InstanceType<typeof import('vuetify/components').VDataTableServer> | null>(
  null
)

// Forward table options update to parent for data loading
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleTableOptions = (options: any): void => {
  emit('update:options', options)
}

const handleRowClick = (_event: Event, data: { item: CohortVariant }): void => {
  pendingScrollBehavior.value = 'smooth'
  lastKeyboardMoveAtMs.value = null
  selectByClick(data.item)
  emit('row-click', data.item)
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
const lastKeyboardMoveAtMs = ref<number | null>(null)
const pendingScrollBehavior = ref<ScrollBehavior>('smooth')

onKeyStroke(
  'ArrowDown',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    e.preventDefault()
    const now = performance.now()
    pendingScrollBehavior.value = getAdaptiveRowScrollBehavior(lastKeyboardMoveAtMs.value, now)
    lastKeyboardMoveAtMs.value = now
    moveDown()
  },
  { dedupe: true }
)

onKeyStroke(
  'ArrowUp',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    e.preventDefault()
    const now = performance.now()
    pendingScrollBehavior.value = getAdaptiveRowScrollBehavior(lastKeyboardMoveAtMs.value, now)
    lastKeyboardMoveAtMs.value = now
    moveUp()
  },
  { dedupe: true }
)

onKeyStroke(
  'Enter',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('row-click', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'Escape',
  (e: KeyboardEvent) => {
    if (!viewActive.value || isInputFocused()) return
    e.preventDefault()
    clearSelection()
    emit('deselect')
  },
  { dedupe: true }
)

// Action shortcuts on selected row
onKeyStroke(
  's',
  (e: KeyboardEvent) => {
    if (hasCommandModifier(e) || !viewActive.value || isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('star-toggle', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'c',
  (e: KeyboardEvent) => {
    if (hasCommandModifier(e) || !viewActive.value || isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('comment-click', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'a',
  (e: KeyboardEvent) => {
    if (hasCommandModifier(e) || !viewActive.value || isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('acmg-evidence-click', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'e',
  (e: KeyboardEvent) => {
    if (hasCommandModifier(e) || !viewActive.value || isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    const key = navSelectedItem.value.variant_key
    const idx = expandedRows.value.indexOf(key)
    if (idx === -1) {
      expandedRows.value = [...expandedRows.value, key]
    } else {
      expandedRows.value = expandedRows.value.filter((k) => k !== key)
    }
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
  row?.scrollIntoView({ block: 'nearest', behavior: pendingScrollBehavior.value })
  pendingScrollBehavior.value = 'smooth'
})

// Expanded rows: ask the parent orchestrator to load carriers (it owns the IPC
// call and updates the carrier cache via useCarriers).
watch(expandedRows, (newExpandedKeys) => {
  for (const key of newExpandedKeys) {
    if (!hasCarriers(key)) {
      const variant = props.variants.find((v) => v.variant_key === key)
      if (variant) {
        emit('load-carriers', variant)
      }
    }
  }
})

// Initialize scroll sync after component mounts
onMounted(async () => {
  await nextTick()
  const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
  if (tableEl) {
    const tableWrapper = tableEl.querySelector('.v-table__wrapper') as HTMLElement | null
    if (tableWrapper) {
      initScrollSync(tableWrapper)
    }
  }
})

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
      tagIds: [],
      annotationScope: 'case',
      activePanelIds: [],
      panelPaddingBp: 5000,
      inheritanceModes: [],
      analysisGroupId: null,
      considerPhasing: false,
      columnFilters: {}
    },
    [],
    colFilters
  ).filter((f) => f.id.startsWith('col:'))
})

// Expose refresh method and column filter state for parent to call
const refresh = (): void => {
  clearCarrierCache()
}

defineExpose({
  refresh,
  columnActiveFilters,
  clearColumnFilter,
  clearAllColumnFilters,
  hasColumnFilters,
  columnFilterCount
})
</script>

<style src="../data-table-shared.css"></style>
<style scoped>
/* Consequence cell (CohortDataTable-specific) */
.consequence-cell {
  font-size: 0.9em;
}
</style>
