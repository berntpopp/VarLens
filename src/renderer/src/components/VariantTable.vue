<template>
  <div class="table-container">
    <!-- Loading skeleton for initial load -->
    <v-skeleton-loader
      v-if="loading && variants.length === 0"
      type="table-heading, table-row@10"
      class="variant-table-skeleton"
    />

    <template v-else>
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
          #[`header.${col.key}`]="{ column: headerColumn, getSortIcon, toggleSort, isSorted }"
        >
          <VariantColumnHeader
            :header-column="headerColumn"
            :get-sort-icon="getSortIcon"
            :toggle-sort="toggleSort"
            :is-sorted="isSorted"
            :has-filter="hasColumnFilter(col.key)"
            :filter-value="columnFilters[col.key] || ''"
            @update:filter="(v) => setColumnFilter(col.key, v)"
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
            @star-toggle="handleStarToggle(item)"
            @acmg-select="(c) => handleQuickAcmgSelect(item, c)"
            @acmg-evidence-click="openAcmgEvidenceDialog(item)"
            @comment-click="openCommentDialog(item)"
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
          <span v-else class="text-grey">&mdash;</span>
        </template>

        <!-- Consequence (handle null) -->
        <template #[`item.consequence`]="{ value }">
          <ConsequenceCell :consequence="value" />
        </template>

        <!-- GT (handle null) -->
        <template #[`item.gt_num`]="{ value }">
          {{ value ?? '-' }}
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
          <span v-else>-</span>
        </template>

        <!-- Qual score (handle null) -->
        <template #[`item.qual`]="{ value }">
          {{ value !== null ? value.toFixed(1) : '-' }}
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
          <span v-else>-</span>
        </template>

        <!-- cDNA (handle null) -->
        <template #[`item.cdna`]="{ value }">
          <span class="hgvs-notation">{{ value ?? '-' }}</span>
        </template>

        <!-- AA Change (handle null) -->
        <template #[`item.aa_change`]="{ value }">
          <span class="hgvs-notation">{{ value ?? '-' }}</span>
        </template>

        <!-- HPO Sim Score (handle null) -->
        <template #[`item.hpo_sim_score`]="{ value }">
          {{ value !== null ? value.toFixed(2) : '-' }}
        </template>

        <!-- MoI (handle null) -->
        <template #[`item.moi`]="{ value }">
          {{ value ?? '-' }}
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
      </v-data-table-server>
    </template>

    <v-snackbar
      v-model="snackbar.visible"
      :color="snackbar.color"
      :timeout="3000"
      location="bottom"
    >
      {{ snackbar.message }}
    </v-snackbar>

    <CommentDialog
      v-model="commentDialogOpen"
      :global-comment="
        selectedVariantForComment
          ? getGlobalComment(
              selectedVariantForComment.chr,
              selectedVariantForComment.pos,
              selectedVariantForComment.ref,
              selectedVariantForComment.alt
            )
          : null
      "
      :per-case-comment="
        selectedVariantForComment
          ? getPerCaseComment(
              selectedVariantForComment.chr,
              selectedVariantForComment.pos,
              selectedVariantForComment.ref,
              selectedVariantForComment.alt
            )
          : null
      "
      :global-timestamps="getGlobalTimestamps(selectedVariantForComment)"
      :per-case-timestamps="getPerCaseTimestamps(selectedVariantForComment)"
      @save="handleCommentSave"
    />

    <AcmgEvidenceDialog
      ref="acmgEvidenceDialogRef"
      :evidence-json="acmgEvidenceJson"
      :variant-data="acmgVariantData"
      :variant-label="acmgVariantLabel"
      :variant-cdna="selectedVariantForAcmg?.cdna ?? null"
      :variant-aa-change="selectedVariantForAcmg?.aa_change ?? null"
      @change="handleAcmgEvidenceChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, toRef, onMounted, nextTick } from 'vue'
import type {
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem
} from '../../../shared/types/api'
import { useSettingsStore } from '../stores/settingsStore'
import { useAnnotations } from '../composables/useAnnotations'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useColumnFilters } from '../composables/useColumnFilters'
import { useDebounce } from '../composables/useDebounce'
import { useVariantLinks } from '../composables/useVariantLinks'
import { useAnnotationDialogs } from '../composables/useAnnotationDialogs'
import { formatConsequence } from '../utils/formatters'
import { useTableScroll } from '../composables/useTableScroll'
import { APP_CONFIG } from '../../../shared/config'
import { useApiService } from '../composables/useApiService'
import CommentDialog from './CommentDialog.vue'
import AcmgEvidenceDialog from './AcmgEvidenceDialog.vue'
import VariantColumnHeader from './variant-table/VariantColumnHeader.vue'
import {
  PositionCell,
  AlleleCell,
  ClinVarCell,
  FrequencyCell,
  CaddScoreCell,
  GeneSymbolCell,
  ConsequenceCell,
  ExternalLinkCell,
  AnnotationsCell
} from './table-cells'

interface Props {
  caseId: number
  filters: Omit<VariantFilter, 'case_id'>
}

const props = defineProps<Props>()
const { api } = useApiService()

const itemsPerPageOptions = [...APP_CONFIG.ITEMS_PER_PAGE_OPTIONS]

const emit = defineEmits<{
  'update:counts': [counts: { filtered: number; total: number }]
  'update:hasSort': [hasSort: boolean]
  'row-click': [variant: Variant]
}>()

// Initialize stores
const settingsStore = useSettingsStore()

// Initialize annotations composable
const {
  isStarred,
  isGlobalStarred,
  getAcmgClassification,
  getGlobalAcmgClassification,
  getAcmgEvidence,
  loadAnnotationsBatch,
  toggleStar,
  clearCache,
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  getGlobalComment,
  getPerCaseComment,
  upsertGlobalComment,
  upsertPerCaseComment,
  getAnnotations
} = useAnnotations()

// Initialize variant links composable
const { linksStore, snackbar, buildOmimEntryUrl, resolveLink, getLinkForColumn, openExternalLink } =
  useVariantLinks()

// Initialize annotation dialogs composable
const {
  commentDialogOpen,
  selectedVariantForComment,
  selectedVariantForAcmg,
  acmgEvidenceDialogRef,
  acmgEvidenceJson,
  acmgVariantData,
  acmgVariantLabel,
  openCommentDialog,
  openAcmgEvidenceDialog,
  handleStarToggle,
  handleQuickAcmgSelect,
  handleAcmgEvidenceChange,
  handleCommentSave,
  getGlobalTimestamps,
  getPerCaseTimestamps
} = useAnnotationDialogs(toRef(props, 'caseId'), {
  getAcmgEvidence,
  toggleStar,
  setAcmgClassification,
  setAcmgClassificationWithEvidence,
  upsertGlobalComment,
  upsertPerCaseComment,
  getAnnotations
})
// acmgEvidenceDialogRef is used as template ref (not detected by vue-tsc from destructured composable)
void acmgEvidenceDialogRef

// Initialize column preferences (only prefs needed here, management is in FilterToolbar)
const { prefs } = useColumnPreferences('variant-table')

// Per-column text filters
const {
  columnFilters,
  hasActiveFilters: hasColumnFilters,
  activeFilterCount: columnFilterCount,
  setColumnFilter,
  clearColumnFilter,
  clearAllColumnFilters,
  hasFilter: hasColumnFilter,
  getColumnFiltersParam
} = useColumnFilters()

// Template refs (used in template via ref="...")
// @ts-expect-error - These refs ARE used in template bindings
const { topScrollbarRef, topScrollbarInnerRef, initScrollSync } = useTableScroll()

// Table refs
const dataTableRef = ref<InstanceType<typeof import('vuetify/components').VDataTableServer> | null>(
  null
)

// Table state - DO NOT mutate these in loadVariants handler (infinite loop)
const variants = ref<Variant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const page = ref(1)
const itemsPerPage = ref(settingsStore.itemsPerPage)
const sortBy = ref<SortItem[]>([])

// Sync items-per-page changes back to settings store
watch(itemsPerPage, (v) => {
  settingsStore.itemsPerPage = v
})

// Cursor cache for pagination - keyed by "page-sortKey-sortOrder"
const cursorCache = ref<Map<string, PaginationCursor>>(new Map())

// Track unfiltered count for "X of Y" display
const unfilteredCount = ref(0)

// Selected row tracking for highlighting
const selectedVariantId = ref<number | null>(null)

// Base headers definition (without virtual links)
const baseHeaders = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' as const },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' as const },
  { title: 'Ref', key: 'ref', sortable: false, width: '100px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '100px' },
  { title: 'GT', key: 'gt_num', sortable: true },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'OMIM', key: 'omim_mim_number', sortable: true, width: '100px' },
  { title: 'Func', key: 'func', sortable: true },
  { title: 'Consequence', key: 'consequence', sortable: true },
  { title: 'Transcript', key: 'transcript', sortable: true },
  { title: 'cDNA', key: 'cdna', sortable: true },
  { title: 'AA Change', key: 'aa_change', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' as const },
  { title: 'CADD', key: 'cadd', sortable: true, align: 'end' as const },
  { title: 'Qual', key: 'qual', sortable: true, align: 'end' as const },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'HPO Score', key: 'hpo_sim_score', sortable: true, align: 'end' as const },
  { title: 'MoI', key: 'moi', sortable: true }
]

// Dynamic headers with virtual link columns from store
const headers = computed(() => {
  const allHeaders = [...baseHeaders]

  // Add virtual column headers from store
  for (const link of linksStore.virtualLinks) {
    allHeaders.push({ title: link.name, key: `_link_${link.id}`, sortable: false, width: '80px' })
  }

  return allHeaders
})

// Ordered columns based on user preferences
const orderedColumns = computed(() => {
  const base = headers.value
  if (prefs.value.order.length > 0) {
    // Sort by saved order, items not in order go to end
    return [...base].sort((a, b) => {
      const aIdx = prefs.value.order.indexOf(a.key)
      const bIdx = prefs.value.order.indexOf(b.key)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }
  return base
})

// Visible headers based on user preferences
const visibleHeaders = computed(() => {
  return orderedColumns.value.filter((h) => prefs.value.visibility[h.key] !== false)
})

// Filterable columns: sortable data columns (exclude annotations, actions, and link columns)
const filterableColumns = computed(() =>
  visibleHeaders.value.filter(
    (h) => h.sortable !== false && !h.key.startsWith('_link_') && h.key !== 'annotations'
  )
)

// Row click handler - track selection and emit event
const handleRowClick = (_event: unknown, { item }: { item: Variant }): void => {
  selectedVariantId.value = item.id
  emit('row-click', item)
}

// Row props for zebra striping and selection highlighting
const getRowProps = ({ item, index }: { item: Variant; index: number }) => {
  const classes: string[] = []

  // Zebra striping
  if (index % 2 === 1) {
    classes.push('variant-row--striped')
  }

  // Selection highlight
  if (item.id === selectedVariantId.value) {
    classes.push('variant-row--selected')
  }

  return { class: classes.join(' ') }
}

// Load variants from backend
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadVariants = async (_options?: any): Promise<void> => {
  // Guard for browser dev mode (no preload)
  if (!api) {
    // eslint-disable-next-line no-undef
    console.warn('API not available - running outside Electron')
    return
  }

  loading.value = true
  try {
    // Build cursor cache key from current sort state
    const sortKey = sortBy.value.length > 0 ? sortBy.value[0].key : 'default'
    const sortOrder = sortBy.value.length > 0 ? sortBy.value[0].order : 'asc'
    const cacheKey = `${page.value}-${sortKey}-${sortOrder}`

    // Get cursor for requested page (undefined for page 1)
    const cursor = page.value === 1 ? undefined : cursorCache.value.get(cacheKey)

    // Call IPC with filters and sortBy parameters
    // Deep-clone to strip all nested Vue reactive proxies (toRaw is shallow)
    const plainFilters = JSON.parse(JSON.stringify(props.filters))
    // Merge per-column text filters
    const colFilters = getColumnFiltersParam()
    if (colFilters !== undefined) {
      plainFilters.column_filters = colFilters
    }
    const plainSortBy = JSON.parse(JSON.stringify(sortBy.value))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result: PaginatedResult<Variant> = await (window as any).api.variants.query(
      props.caseId,
      plainFilters,
      cursor,
      itemsPerPage.value,
      plainSortBy
    )

    // Update display state (ONLY mutate these in handler, never page/itemsPerPage/sortBy)
    variants.value = result.data
    totalCount.value = result.total_count

    // Emit counts to parent for toolbar display
    emit('update:counts', {
      filtered: result.total_count,
      total: unfilteredCount.value
    })

    // Cache next cursor if more results available
    if ((result.next_cursor ?? null) !== null && result.has_more) {
      const nextCacheKey = `${page.value + 1}-${sortKey}-${sortOrder}`

      cursorCache.value.set(nextCacheKey, result.next_cursor!)
    }
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load variants:', error)
    variants.value = []
    totalCount.value = 0
  } finally {
    loading.value = false
  }
}

// Fetch unfiltered count on case change
watch(
  () => props.caseId,
  async (newCaseId) => {
    // Clear selection and column filters on case change
    selectedVariantId.value = null
    clearAllColumnFilters()

    if (newCaseId !== undefined && newCaseId !== 0) {
      // Clear cache and reset pagination
      cursorCache.value.clear()
      page.value = 1

      // Clear annotation cache on case switch
      clearCache()

      // Fetch unfiltered count (query with empty filters)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (api as any).variants.query(newCaseId, {}, undefined, 1, [])
      unfilteredCount.value = result.total_count
    }
  },
  { immediate: true }
)

// Clear cache when sort changes (sort change invalidates all cursors)
watch(
  sortBy,
  () => {
    cursorCache.value.clear()
    page.value = 1
    // Emit sort state for Clear button activation
    emit('update:hasSort', sortBy.value.length > 0)
  },
  { deep: true }
)

// Clear cache and reload when filters change (CRITICAL per RESEARCH.md Pitfall 2)
watch(
  () => props.filters,
  async () => {
    cursorCache.value.clear()
    page.value = 1
    // Explicitly call loadVariants - page change alone won't trigger if already on page 1
    await loadVariants()
  },
  { deep: true }
)

// Debounced reload when per-column filters change
const { debouncedFn: debouncedColumnFilterReload } = useDebounce(async () => {
  cursorCache.value.clear()
  page.value = 1
  await loadVariants()
}, 300)
watch(getColumnFiltersParam, debouncedColumnFilterReload, { deep: true })

// Load annotations when variants change
watch(
  variants,
  async (newVariants) => {
    if (newVariants.length > 0 && props.caseId !== undefined && props.caseId !== 0) {
      await loadAnnotationsBatch(props.caseId, newVariants)
    }
  },
  { immediate: true }
)

// Reset sort to default (no sorting)
const resetSort = () => {
  sortBy.value = []
}

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

// Expose resetSort for parent components
defineExpose({
  resetSort,
  refresh: loadVariants,
  columns: computed(() => headers.value.map((h) => ({ key: h.key, title: h.title }))),
  hasColumnFilters,
  columnFilterCount,
  clearAllColumnFilters
})
</script>

<style scoped>
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

/* Loading skeleton */
.variant-table-skeleton {
  padding: 16px;
}

.variant-table-skeleton :deep(.v-skeleton-loader__bone) {
  margin-bottom: 8px;
}

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

/* Custom scrollbar styling for top scrollbar */
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

.external-link--clicked {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent);
  border-radius: 2px;
}

.hgvs-notation {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

.variant-data-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

.transcript-truncated {
  max-width: 120px;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
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
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent) !important;
  border-left: 4px solid rgb(var(--v-theme-primary)) !important;
  transition: background-color 0.15s ease;
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

/* Ensure table can scroll horizontally when columns overflow */
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
