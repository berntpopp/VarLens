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
      v-model:expanded="expandedRows"
      :headers="headers"
      :items="variants"
      :items-length="totalCount"
      :loading="loading"
      :items-per-page-options="itemsPerPageOptions"
      item-value="variant_key"
      density="compact"
      show-expand
      class="elevation-1"
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

      <!-- Ref allele -->
      <template #[`item.ref`]="{ value }">
        <AlleleCell :allele="value" />
      </template>

      <!-- Alt allele -->
      <template #[`item.alt`]="{ value }">
        <AlleleCell :allele="value" />
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

      <!-- cDNA HGVS -->
      <template #[`item.cdna`]="{ value }">
        <span class="hgvs-notation">{{ value ?? '--' }}</span>
      </template>

      <!-- Protein change -->
      <template #[`item.aa_change`]="{ value }">
        <span class="hgvs-notation">{{ value ?? '--' }}</span>
      </template>

      <!-- Impact/Consequence -->
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

      <!-- gnomAD allele frequency -->
      <template #[`item.gnomad_af`]="{ value }">
        <FrequencyCell :frequency="value" />
      </template>

      <!-- CADD phred score -->
      <template #[`item.cadd_phred`]="{ value }">
        <CaddScoreCell :score="value" />
      </template>

      <!-- Carrier count -->
      <template #[`item.carrier_count`]="{ item }">
        {{ item.carrier_count ?? 0 }}
      </template>

      <!-- Cohort frequency -->
      <template #[`item.cohort_frequency`]="{ value }">
        {{ value !== null && value !== undefined ? (value * 100).toFixed(2) + '%' : '--' }}
      </template>

      <!-- Het / Hom combined column -->
      <template #[`item.het_count`]="{ item }">
        {{ item.het_count ?? 0 }} / {{ item.hom_count ?? 0 }}
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
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import { useTableKeyboardNav } from '../../composables/useTableKeyboardNav'
import { onKeyStroke } from '@vueuse/core'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { AcmgClassification } from '../../../../main/database/types'
import type { SortItem } from '../../composables/useOffsetPagination'
import { useApiService } from '../../composables/useApiService'
import { useTableScroll } from '../../composables/useTableScroll'
import { useTableRowProps } from '../../composables/useTableRowProps'
import { useCarriers } from '../../composables/useCarriers'
import {
  PositionCell,
  AlleleCell,
  ClinVarCell,
  FrequencyCell,
  CaddScoreCell,
  GeneSymbolCell,
  ConsequenceCell,
  AnnotationsCell,
  ExternalLinkCell
} from '../table-cells'
import CarrierExpandedRow from './CarrierExpandedRow.vue'
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
import { useExternalLinksStore, type ExternalLinkConfig } from '../../stores/externalLinksStore'
import { APP_CONFIG } from '../../../../shared/config'
import { resolveUrlTemplate, type VariantLinkData } from '../../utils/externalLinks'

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

const itemsPerPageOptions = [...APP_CONFIG.ITEMS_PER_PAGE_OPTIONS]

const props = defineProps<Props>()

// Composables
const { api } = useApiService()
// Template refs (used in template via ref="...")
// @ts-expect-error - These refs ARE used in template bindings
const { topScrollbarRef, topScrollbarInnerRef, initScrollSync } = useTableScroll()
const { getRowProps } = useTableRowProps<CohortVariant>({
  selectedId: ref(props.selectedVariantKey),
  getItemId: (item: CohortVariant) => item.variant_key
})
const { expandedRows, getCarriers, hasCarriers, clearCache: clearCarrierCache } = useCarriers()

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
    // onSelect intentionally empty — row-click is emitted by handleRowClick
    // (mouse) and Enter handler (keyboard) separately.
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
      !h.key.startsWith('_link_') &&
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
watch(
  getColumnFiltersParam,
  (newFilters) => {
    debouncedEmitColumnFilters(newFilters)
  },
  { deep: true }
)

// Stores
const linksStore = useExternalLinksStore()

// ============================================================================
// External link resolution helpers (same as VariantTable.vue)
// ============================================================================

/**
 * Get link data for a cohort variant
 */
const getVariantLinkData = (item: CohortVariant): VariantLinkData => ({
  chr: item.chr,
  pos: item.pos,
  ref: item.ref,
  alt: item.alt,
  gene_symbol: item.gene_symbol ?? null,
  mim_number: null // Cohort variants don't have OMIM MIM numbers
})

/**
 * Resolve URL for a link and variant
 */
const resolveLink = (linkId: string, item: CohortVariant): string | null => {
  const link = linksStore.enabledLinks.find((l) => l.id === linkId)
  if (link === undefined) return null
  return resolveUrlTemplate(
    link.urlTemplate,
    getVariantLinkData(item),
    linksStore.genomeBuild,
    link.requiredFields
  )
}

/**
 * Get link config for a column
 */
const getLinkForColumn = (column: string): ExternalLinkConfig | null => {
  return linksStore.enabledLinks.find((l) => l.column === column) ?? null
}

/**
 * Handle external link click
 */
const openExternalLink = async (url: string, event?: MouseEvent): Promise<void> => {
  if (!url) return

  // Brief highlight on clicked element
  const target = event?.currentTarget as HTMLElement
  if (target !== null && target !== undefined) {
    target.classList.add('external-link--clicked')
    // eslint-disable-next-line no-undef
    setTimeout(() => target.classList.remove('external-link--clicked'), 200)
  }

  if (api) {
    try {
      await api.shell.openExternal(url)
    } catch {
      // Error logged silently - external link opening is best-effort
    }
  }
}

// Table state
const dataTableRef = ref<InstanceType<typeof import('vuetify/components').VDataTableServer> | null>(
  null
)

/**
 * Forward table options update to parent for data loading
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleTableOptions = (options: any): void => {
  emit('update:options', options)
}

/**
 * Handle row click
 */
const handleRowClick = (_event: Event, data: { item: CohortVariant }): void => {
  selectByClick(data.item)
  emit('row-click', data.item)
}

// Keyboard navigation handlers
onKeyStroke(
  'ArrowDown',
  (e: KeyboardEvent) => {
    if (isInputFocused()) return
    e.preventDefault()
    moveDown()
  },
  { dedupe: true }
)

onKeyStroke(
  'ArrowUp',
  (e: KeyboardEvent) => {
    if (isInputFocused()) return
    e.preventDefault()
    moveUp()
  },
  { dedupe: true }
)

onKeyStroke(
  'Enter',
  (e: KeyboardEvent) => {
    if (isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('row-click', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'Escape',
  (e: KeyboardEvent) => {
    if (isInputFocused()) return
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
    if (isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('star-toggle', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'c',
  (e: KeyboardEvent) => {
    if (isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('comment-click', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'a',
  (e: KeyboardEvent) => {
    if (isInputFocused()) return
    if (navSelectedItem.value === null) return
    e.preventDefault()
    emit('acmg-evidence-click', navSelectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  'e',
  (e: KeyboardEvent) => {
    if (isInputFocused()) return
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
  row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
})

/**
 * Watch for expanded rows - emit load-carriers event for parent orchestration
 *
 * This component doesn't load carriers directly - it asks the parent orchestrator
 * to handle the IPC call. The parent will then update the carrier cache via useCarriers.
 */
watch(expandedRows, (newExpandedKeys) => {
  for (const key of newExpandedKeys) {
    if (!hasCarriers(key)) {
      // Find the variant from props
      const variant = props.variants.find((v) => v.variant_key === key)
      if (variant) {
        // Emit to parent for orchestration
        emit('load-carriers', variant)
      }
    }
  }
})

/**
 * Initialize scroll sync after component mounts
 */
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
      minCohortFrequency: null,
      minCarriers: null,
      starredOnly: false,
      hasCommentOnly: false,
      acmgClassifications: []
    },
    [],
    colFilters
  ).filter((f) => f.id.startsWith('col:'))
})

/**
 * Expose refresh method and column filter state for parent to call
 */
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

<style scoped>
/* Header styles now in shared VariantColumnHeader component */

/* Table container fills remaining height in flex parent */
.table-container {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* Make data table fill available space */
:deep(.v-data-table) {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

:deep(.v-table__wrapper) {
  flex: 1;
  overflow-y: auto;
}

/* Top scrollbar (synced with table) */
.top-scrollbar-container {
  overflow-x: auto;
  overflow-y: hidden;
  height: 12px;
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 3%, transparent);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
}

.top-scrollbar-inner {
  height: 1px;
}

.top-scrollbar-container::-webkit-scrollbar {
  height: 10px;
}

.top-scrollbar-container::-webkit-scrollbar-track {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 5%, transparent);
}

.top-scrollbar-container::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 20%, transparent);
  border-radius: 5px;
}

.top-scrollbar-container::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 35%, transparent);
}

.hgvs-notation {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

.consequence-cell {
  font-size: 0.9em;
}

/* Clickable table rows with improved hover */
:deep(.v-data-table tbody tr) {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

/* Zebra striping for better scanability */
:deep(.v-data-table tbody tr.variant-row--striped) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 3.5%, transparent);
}

/* Selected row highlighting - prominent with left accent border */
:deep(.v-data-table tbody tr.variant-row--selected) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 12%, transparent) !important;
  border-left: 4px solid rgb(var(--v-theme-primary)) !important;
}

:deep(.v-data-table tbody tr.variant-row--selected td:first-child) {
  padding-left: calc(16px - 4px);
}

/* Hover state - visible but subtle */
:deep(.v-data-table tbody tr:hover) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent) !important;
}

/* Selected + hover - slightly darker */
:deep(.v-data-table tbody tr.variant-row--selected:hover) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent) !important;
}

/* Column max-width with ellipsis and horizontal scroll */
:deep(.v-data-table th),
:deep(.v-data-table td) {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.v-table__wrapper) {
  overflow-x: auto;
}

/* Style bottom scrollbar to match top scrollbar */
:deep(.v-table__wrapper)::-webkit-scrollbar {
  height: 10px;
}

:deep(.v-table__wrapper)::-webkit-scrollbar-track {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 5%, transparent);
}

:deep(.v-table__wrapper)::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 20%, transparent);
  border-radius: 5px;
}

:deep(.v-table__wrapper)::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface)) 35%, transparent);
}
</style>
