<template>
  <div class="table-container">
    <!-- Top scrollbar (synced with table) -->
    <div ref="topScrollbarRef" class="top-scrollbar-container">
      <div ref="topScrollbarInnerRef" class="top-scrollbar-inner"></div>
    </div>

    <v-data-table-server
      ref="dataTableRef"
      v-model:items-per-page="itemsPerPage"
      v-model:sort-by="sortBy"
      v-model:expanded="expandedRows"
      :headers="headers"
      :items="variants"
      :items-length="totalCount"
      :loading="loading"
      :page="props.page"
      :items-per-page-options="[10, 25, 50, 100]"
      item-value="variant_key"
      density="compact"
      show-expand
      class="elevation-1"
      :row-props="getRowProps"
      @update:options="handleTableOptions"
      @click:row="handleRowClick"
    >
      <!-- Custom header slots with per-column filter icons -->
      <template
        v-for="col in filterableColumns"
        :key="`header-${col.key}`"
        #[`header.${col.key}`]="{ column: headerColumn, getSortIcon, toggleSort, isSorted }"
      >
        <div class="d-flex align-center justify-space-between header-wrapper">
          <div
            class="d-flex align-center flex-grow-1 sortable-header"
            @click="toggleSort(headerColumn)"
          >
            <span class="header-title">{{ headerColumn.title }}</span>
            <v-icon v-if="isSorted(headerColumn)" size="x-small" class="ml-1">
              {{ getSortIcon(headerColumn) }}
            </v-icon>
            <v-icon v-else size="x-small" class="ml-1 sort-icon-inactive">mdi-sort</v-icon>
          </div>
          <v-menu :close-on-content-click="false" location="bottom">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                icon
                size="x-small"
                variant="text"
                :color="hasColumnFilter(col.key) ? 'primary' : undefined"
                @click.stop
              >
                <v-icon size="x-small">
                  {{ hasColumnFilter(col.key) ? 'mdi-filter' : 'mdi-filter-outline' }}
                </v-icon>
              </v-btn>
            </template>
            <v-card min-width="250" max-width="350">
              <v-card-title class="text-subtitle-2 py-2">
                Filter: {{ headerColumn.title }}
              </v-card-title>
              <v-divider />
              <v-card-text class="pa-3">
                <v-text-field
                  :model-value="columnFilters[col.key] || ''"
                  label="Filter value"
                  placeholder="Type to filter..."
                  density="compact"
                  variant="outlined"
                  clearable
                  hide-details
                  autofocus
                  @update:model-value="(v: string | null) => setColumnFilter(col.key, v)"
                >
                  <template #prepend-inner>
                    <v-icon size="small">mdi-magnify</v-icon>
                  </template>
                </v-text-field>
                <div class="text-caption text-medium-emphasis mt-2">
                  Case-insensitive partial match
                </div>
              </v-card-text>
              <v-divider />
              <v-card-actions class="pa-2">
                <v-spacer />
                <v-btn size="small" variant="text" @click="clearColumnFilter(col.key)">
                  Clear
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-menu>
        </div>
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
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { AcmgClassification } from '../../../../main/database/types'
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
import { useColumnFilters } from '../../composables/useColumnFilters'
import { useDebounce } from '../../composables/useDebounce'
import { useExternalLinksStore, type ExternalLinkConfig } from '../../stores/externalLinksStore'
import { useSettingsStore } from '../../stores/settingsStore'
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
  /** Current page number (controlled by parent for cursor pagination) */
  page?: number
  selectedVariantKey: string | null
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

interface Emits {
  (
    e: 'update:options',
    options: {
      page: number
      itemsPerPage: number
      sortBy: Array<{ key: string; order: 'asc' | 'desc' }>
    }
  ): void
  (e: 'row-click', variant: CohortVariant): void
  (e: 'star-toggle', item: CohortVariant): void
  (
    e: 'acmg-select',
    payload: { item: CohortVariant; classification: AcmgClassification | null }
  ): void
  (e: 'acmg-evidence-click', item: CohortVariant): void
  (e: 'comment-click', item: CohortVariant): void
  (e: 'navigate-to-case', payload: { caseId: number; item: CohortVariant }): void
  (e: 'load-carriers', variant: CohortVariant): void
  (e: 'column-filters-change', filters: Record<string, string> | undefined): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

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

// Per-column text filters
const {
  columnFilters,
  setColumnFilter,
  clearColumnFilter,
  hasFilter: hasColumnFilter,
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

// Debounced emit when column filters change
const { debouncedFn: debouncedEmitColumnFilters } = useDebounce(
  (newFilters: Record<string, string> | undefined) => {
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
const settingsStore = useSettingsStore()

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
const itemsPerPage = ref(settingsStore.itemsPerPage)
const sortBy = ref<Array<{ key: string; order: 'asc' | 'desc' }>>([])

// Sync items-per-page changes back to settings store
watch(itemsPerPage, (v) => {
  settingsStore.itemsPerPage = v
})

/**
 * Handle table options update (pagination, sorting)
 */
const handleTableOptions = (options: {
  page: number
  itemsPerPage: number
  sortBy: Array<{ key: string; order: 'asc' | 'desc' }>
}): void => {
  emit('update:options', options)
}

/**
 * Handle row click
 */
const handleRowClick = (_event: Event, data: { item: CohortVariant }): void => {
  emit('row-click', data.item)
}

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

/**
 * Expose refresh method for parent to call
 */
const refresh = (): void => {
  clearCarrierCache()
}

defineExpose({ refresh })
</script>

<style scoped>
/* Per-column filter header layout */
.header-wrapper {
  width: 100%;
  gap: 4px;
}

.sortable-header {
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.sortable-header:hover {
  opacity: 0.7;
}

.header-title {
  font-weight: 600;
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sort-icon-inactive {
  opacity: 0.3;
}

.sortable-header:hover .sort-icon-inactive {
  opacity: 0.6;
}

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
