<template>
  <div ref="tableContainerRef" class="table-container">
    <div ref="topScrollbarRef" class="top-scrollbar-container">
      <div ref="topScrollbarInnerRef" class="top-scrollbar-inner"></div>
    </div>

    <QueryErrorAlert :error="loadError" :stale="variants.length > 0" @retry="loadVariants" />
    <TableLoadIndicator :active="showStale" :message="liveMessage" />
    <SummaryStaleNotice :stale="summaryStale" />
    <v-data-table-server
      ref="dataTableRef"
      v-model:page="page"
      v-model:items-per-page="tableItemsPerPage"
      v-model:sort-by="sortBy"
      :headers="visibleHeaders"
      :items="renderRows"
      :item-value="rowKey"
      :items-length="totalCount"
      :loading="firstLoad"
      :items-per-page-options="pageSizeOptions"
      :aria-busy="ariaBusy"
      density="compact"
      fixed-header
      multi-sort
      :show-select="canBulkWrite"
      class="elevation-1 variant-table--sticky"
      :class="{ 'table--stale': showStale, 'variant-table--selectable': canBulkWrite }"
      :row-props="getRowProps"
      @update:options="loadVariants"
      @click:row="handleRowClick"
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
          :aria-label="`Select ${item.gene_symbol ?? ''} ${item.chr}:${item.pos}`"
          :data-testid="`bulk-select-row-${item.id}`"
          class="bulk-select-checkbox"
          @click.stop="bulkSelection.handleRowCheckboxClick(item.id, $event)"
        />
      </template>

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
          :busy="col.key === phenotype.PHENOTYPE_COLUMN_KEY && phenotypeRefreshing"
          @apply-filter="(f) => setColumnFilter(col.key, f)"
          @clear-filter="clearColumnFilter(col.key)"
        />
      </template>

      <template #[`header.annotations`]><AnnotationsHeader /></template>

      <!-- Annotations column (star, ACMG, comment) -->
      <template #[`item.annotations`]="{ item }">
        <AnnotationsCell
          :is-starred="item.render.isStarred"
          :is-global-starred="item.render.isGlobalStarred"
          :acmg-classification="item.render.acmgClassification"
          :global-acmg-classification="item.render.globalAcmgClassification"
          :has-comment="item.render.hasComment"
          :has-global-comment="item.render.hasGlobalComment"
          :show-global-indicators="true"
          :annotation-scope="annotationScope"
          :read-only="!canWrite"
          :acmg-locked="annotationDialogsRef?.hasAcmgEvidence(item) === true"
          :variant="item"
          tag-source="case"
          @star-toggle="annotationDialogsRef?.handleStarToggle(item)"
          @acmg-select="(c) => annotationDialogsRef?.handleQuickAcmgSelect(item, c)"
          @acmg-evidence-click="annotationDialogsRef?.openAcmgEvidenceDialog(item)"
          @comment-click="annotationDialogsRef?.openCommentDialog(item)"
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

      <!-- gnomAD AF in scientific notation -->
      <template #[`item.gnomad_af`]="{ value }"><FrequencyCell :frequency="value" /></template>

      <!-- ClinVar colored chips with dynamic link from store -->
      <template #[`item.clinvar`]="{ item, value }">
        <ClinVarCell
          :significance="value"
          :url="value ? (item.render.links.clinvar ?? null) : null"
          @click="openExternalLink"
        />
      </template>

      <template #[`item.ref`]="{ value }"><AlleleCell :allele="value" /></template>
      <template #[`item.alt`]="{ value }"><AlleleCell :allele="value" /></template>
      <template #[`item.cadd`]="{ value }"><CaddScoreCell :score="value" /></template>

      <!-- Gene symbol with dynamic link from store -->
      <template #[`item.gene_symbol`]="{ item, value }">
        <GeneSymbolCell
          :value="value"
          :link-url="value ? (item.render.links.gene_symbol ?? null) : null"
          @click="openExternalLink"
        />
      </template>

      <!-- OMIM MIM number with clickable link to OMIM entry -->
      <template #[`item.omim_mim_number`]="{ value }">
        <ExternalLinkCell
          v-if="value && buildOmimEntryUrl(value)"
          :url="buildOmimEntryUrl(value)!"
          :label="value"
          :aria-label="`OMIM ${value} (opens in a new tab)`"
          @click="openExternalLink"
        />
        <EmptyPlaceholder v-else />
      </template>

      <template v-for="key in ['consequence', 'func']" :key="key" #[`item.${key}`]="{ value }">
        <ConsequenceCell :consequence="value" />
      </template>

      <template #[`item.gt_num`]="{ item, value }">
        <GenotypeCell :value="value" :phase="item.comphet_phase" />
      </template>

      <template
        v-for="member in familyMembers"
        :key="`member-${member.case_id}`"
        #[`item._member_${member.case_id}`]="{ item }"
      >
        <FamilyMemberCell :call="item.family_calls?.[member.case_id]" />
      </template>

      <template #[`item.qual`]="{ value }">
        <span v-if="typeof value === 'number'">{{ value.toFixed(1) }}</span>
        <EmptyPlaceholder v-else />
      </template>

      <template #[`item.transcript`]="{ value }"><TranscriptCell :value="value" /></template>

      <template v-for="key in ['cdna', 'aa_change']" :key="key" #[`item.${key}`]="{ value }">
        <HgvsCell :value="value" />
      </template>

      <template #[`item.phenotype_score`]="{ item }"
        ><PhenotypeScoreCell :case-id="caseId" :row="item"
      /></template>

      <template #[`item.hpo_sim_score`]="{ value }">
        <span v-if="typeof value === 'number'">{{ value.toFixed(2) }}</span>
        <EmptyPlaceholder v-else />
      </template>

      <!-- MoI and matched HPO terms (handle null) -->
      <template v-for="key in ['moi', 'hpo_match']" :key="key" #[`item.${key}`]="{ value }">
        <span v-if="value != null">{{ value }}</span>
        <EmptyPlaceholder v-else />
      </template>

      <!-- Merged Links column: one icon link per configured link-out -->
      <template #[`item._links`]="{ item }"
        ><LinkOutsCell :links="linkOuts" :urls="item.render.links" @click="openExternalLink"
      /></template>

      <!-- First-load skeleton only; refetches keep rows (stale-while-revalidate) -->
      <template #loading><TableSkeletonRows :rows="Math.min(itemsPerPage, 15)" /></template>

      <!-- Empty state: each active filter, removable in one click (#568) -->
      <template #no-data>
        <FilterEmptyState
          v-if="loadError === null"
          :filters="activeFilters"
          @remove="emit('clear-filter', $event)"
          @clear-all="emit('clear-filters')"
        />
      </template>
    </v-data-table-server>

    <AcmgQuickMenu :state="acmgQuickMenu" />
    <TagQuickMenu :state="tagQuickMenu" />
    <BulkTriageActionBar
      v-if="canBulkWrite"
      :selected-count="bulkSelection.selectedCount.value"
      :is-executing="bulkSelection.isExecuting.value"
      @apply="bulkSelection.applyBulkTriage"
      @clear="bulkSelection.clearSelection"
    />
    <AnnotationDialogs
      ref="annotationDialogsRef"
      :case-id="caseId"
      :annotation-scope="annotationScope"
      :annotation-actions="annotationActions"
      @changed="handleAnnotationChanged"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRef, watch, nextTick, inject } from 'vue'
import { onMounted, onUnmounted, onActivated, onDeactivated } from 'vue'
import type { AnnotationChangeEvent, Variant, VariantFilter } from '../../../shared/types/api'
import type { AnnotationScope } from '../../../shared/types/annotations'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import type { ActiveFilter } from '../../../shared/types/filters'
import { buildColumnFilterChips } from '../utils/filters/activeFilters'
import { useColumnFilterMeta } from '../composables/useColumnFilterMeta'
import { useAnnotations, annotationCache } from '../composables/useAnnotations'
import { useAcmgUndo } from '../composables/useAcmgUndo'
import { useVariantRowViewModel, type LinkConfig } from './variant-table/useVariantRowViewModel'
import { useVariantRenderRows } from './variant-table/useVariantRenderRows'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useVariantLinks } from '../composables/useVariantLinks'
import { useLinkResolvers } from '../composables/useLinkResolvers'
import { useAutoPageSize } from '../composables/useAutoPageSize'
import { getAdaptiveRowScrollBehavior } from '../utils/adaptiveRowScroll'
import { useTableScroll } from '../composables/useTableScroll'
import {
  useTableKeyboardNav,
  hasCommandModifier,
  isControlFocused
} from '../composables/useTableKeyboardNav'
import { useProteinViewShortcut } from '../composables/useProteinViewShortcut'
import { onKeyStroke } from '@vueuse/core'
import { SHORTCUTS } from '../config/keyboardShortcuts'
import VariantColumnHeader from './variant-table/VariantColumnHeader.vue'
import AnnotationDialogs from './AnnotationDialogs.vue'
import BulkTriageActionBar from './variant-table/BulkTriageActionBar.vue'
import TableLoadIndicator from './table-state/TableLoadIndicator.vue'
import SummaryStaleNotice from './table-state/SummaryStaleNotice.vue'
import QueryErrorAlert from './table-state/QueryErrorAlert.vue'
import TableSkeletonRows from './table-state/TableSkeletonRows.vue'
import PhenotypeScoreCell from './variant-table/PhenotypeScoreCell.vue'
import FilterEmptyState from './filters/FilterEmptyState.vue'
import AcmgQuickMenu from './table-cells/AcmgQuickMenu.vue'
import TagQuickMenu from './table-cells/TagQuickMenu.vue'
import { provideAcmgQuickMenu } from './table-cells/acmg-quick-menu'
import { provideTagQuickMenu } from './table-cells/tag-quick-menu'
import { useResultSetKeys } from './table-state/useResultSetKeys'
import { usePermissions } from '../composables/usePermissions'
import { useTableLoadingState } from '../composables/useTableLoadingState'
import { useFamilyMembers, useVariantColumns } from './variant-table/columns'
import GenotypeCell from './variant-table/GenotypeCell.vue'
import FamilyMemberCell from './variant-table/FamilyMemberCell.vue'
import TranscriptCell from './variant-table/TranscriptCell.vue'
import * as phenotype from './variant-table/usePhenotypeColumn'
import { useVariantData } from './variant-table/useVariantData'
import { useApiService } from '../composables/useApiService'
import { useBulkTriageSelection } from '../composables/useBulkTriageSelection'
import { useDetailsLiveSync } from '../composables/useDetailsLiveSync'
import { AppStateKey } from '../composables/useAppState'
import { isWebRuntime } from '../utils/runtime-mode'
import {
  PositionCell,
  AlleleCell,
  ClinVarCell,
  FrequencyCell,
  CaddScoreCell,
  GeneSymbolCell,
  ConsequenceCell,
  ExternalLinkCell,
  LinkOutsCell,
  AnnotationsCell,
  AnnotationsHeader,
  EmptyPlaceholder,
  HgvsCell
} from './table-cells'

const { canWrite } = usePermissions()

interface Props {
  caseId: number
  filters: Omit<VariantFilter, 'case_id'>
  annotationScope?: AnnotationScope
  columnMeta?: ColumnFilterMeta[]
  variantType?: string
  interactive?: boolean
  activeFilters?: ActiveFilter[]
}

const props = withDefaults(defineProps<Props>(), {
  annotationScope: 'case',
  columnMeta: () => [],
  activeFilters: () => [],
  variantType: 'snv',
  interactive: true
})

const emit = defineEmits<{
  'update:counts': [counts: { filtered: number; total: number }]
  'update:hasSort': [hasSort: boolean]
  'row-click': [variant: Variant]
  deselect: []
  'clear-filter': [id: string]
  'clear-filters': []
}>()

const viewActive = ref(true)
const acmgQuickMenu = provideAcmgQuickMenu()
const tagQuickMenu = provideTagQuickMenu()
const tableWorkActive = computed(() => props.interactive && viewActive.value)
const { api } = useApiService()
const appState = inject(AppStateKey, null)
let cleanupAnnotationChanged: (() => void) | null = null

const caseIdGetter = () => props.caseId
const familyMembers = useFamilyMembers(() => props.filters.analysis_group_id, caseIdGetter, api)

// Bundle annotation actions (with ACMG undo wrappers) for dialog subcomponent
const annotationActions = { ...useAnnotations(), ...useAcmgUndo() }

const { buildOmimEntryUrl, openExternalLink } = useVariantLinks()

// Column preferences and column definitions — swap columns on variant type change
const { prefs } = useColumnPreferences('variant-table')
const variantTypeRef = toRef(props, 'variantType')
const { headers, visibleHeaders, filterableColumns } = useVariantColumns(
  prefs,
  variantTypeRef,
  caseIdGetter,
  familyMembers
)

// Data loading and state
const variantData = useVariantData({
  caseId: toRef(props, 'caseId'),
  filters: toRef(props, 'filters'),
  active: tableWorkActive,
  columnMeta: computed(() => props.columnMeta ?? []),
  onCountsUpdate: (counts) => emit('update:counts', counts),
  onSortUpdate: (hasSort) => emit('update:hasSort', hasSort)
})
const {
  variants,
  totalCount,
  loading,
  loadError,
  summaryStale,
  page,
  itemsPerPage,
  sortBy,
  itemsPerPageOptions,
  selectedVariantId,
  loadVariants,
  reloadCurrentPage,
  buildQueryFilters,
  resetSort,
  getRowProps,
  columnMeta: dataColumnMeta,
  hasActiveFilters: hasColumnFilters,
  activeFilterCount: columnFilterCount,
  setColumnFilter,
  clearColumnFilter,
  clearAllColumnFilters,
  hasFilter,
  getFilter,
  getColumnFiltersParam
} = variantData
const phenotypeRefreshing = phenotype.usePhenotypeRefresh(caseIdGetter, reloadCurrentPage)
const canBulkWrite = computed(() => canWrite.value && props.annotationScope !== 'all')
watch(canBulkWrite, (can) => {
  if (!can) bulkSelection.clearSelection()
})
watch(
  () => props.variantType,
  () => bulkSelection.clearSelection()
)

const bulkSelection = useBulkTriageSelection<Variant>({
  items: () => variants.value,
  getItemId: (v) => v.id,
  caseId: toRef(props, 'caseId'),
  onTriageApplied: () => reloadCurrentPage()
})

// Page size incl. "Auto (fit)": as many rows as fit the visible table body
const tableContainerRef = ref<HTMLElement | null>(null)
const { tableItemsPerPage, pageSizeOptions } = useAutoPageSize({
  itemsPerPage,
  page,
  fixedOptions: itemsPerPageOptions,
  container: tableContainerRef,
  rowCount: computed(() => variants.value.length)
})

// Loading presentation: skeleton on first load only, dim + bar on refetch
const { firstLoad, showStale, ariaBusy, liveMessage, resetFirstLoad } = useTableLoadingState({
  loading,
  totalCount
})
watch(() => props.caseId, resetFirstLoad)

// Column metadata map + filter modes (shared composable)
const { columnMetaMap, columnFilterModes } = useColumnFilterMeta(dataColumnMeta)

// Precomputed link config: one resolver per link slot, updated when store changes
const { resolvers: linkResolvers, linkOuts } = useLinkResolvers()
const linkConfig = computed<Record<string, LinkConfig>>(() =>
  Object.fromEntries(
    Object.entries(linkResolvers.value).map(([key, resolve]) => [key, { id: key, resolve }])
  )
)

// Precomputed row view models: annotation + link state per variant key
const { rowViewModels } = useVariantRowViewModel(variants, annotationCache, linkConfig)
const { renderRows } = useVariantRenderRows(variants, rowViewModels)
const { rowKey } = useResultSetKeys(() => renderRows.value, 'id') // fresh <tr>s per result set

const hasAnnotationBackedFilters = computed(
  () =>
    props.filters.starred_only === true ||
    props.filters.has_comment === true ||
    (props.filters.acmg_classifications?.length ?? 0) > 0
)

function handleAnnotationChanged(): void {
  if (!isWebRuntime() || !hasAnnotationBackedFilters.value) return
  void loadVariants()
}

// Column active filter chips for the toolbar
const columnActiveFilters = computed<ActiveFilter[]>(() => {
  const colFilters = getColumnFiltersParam()
  return colFilters ? buildColumnFilterChips(colFilters) : []
})

// Template refs
const annotationDialogsRef = ref<InstanceType<typeof AnnotationDialogs> | null>(null)

// @ts-expect-error - These refs ARE used in template bindings
const { topScrollbarRef, topScrollbarInnerRef, initScrollSync } = useTableScroll()

const dataTableRef = ref<InstanceType<typeof import('vuetify/components').VDataTableServer> | null>(
  null
)

// Keyboard navigation
const keyboardNav = useTableKeyboardNav({
  items: variants,
  getItemId: (item: Variant) => item.id,
  onSelect: (item: Variant) => {
    selectedVariantId.value = item.id
  }
})
const {
  selectedIndex,
  selectedItem,
  selectByClick,
  moveUp,
  moveDown,
  clearSelection,
  isInputFocused
} = keyboardNav

if (appState) {
  watch(
    () => appState.selectedPanelVariant.value,
    (variant) => {
      if (variant && 'id' in variant && variants.value.some((v) => v.id === variant.id)) {
        selectByClick(variant)
        selectedVariantId.value = variant.id
      } else {
        clearSelection()
        selectedVariantId.value = null
      }
    },
    { immediate: true }
  )
}

const liveSync = useDetailsLiveSync<Variant>({
  isActive: () => viewActive.value && props.interactive,
  selectedItem,
  selectByClick,
  open: (item) => emit('row-click', item)
})

// Row click handler
const handleRowClick = (_event: unknown, { item }: { item: Variant }): void => {
  liveSync.cancel()
  pendingScrollBehavior.value = 'smooth'
  lastKeyboardMoveAtMs.value = null
  const panelVar = appState?.selectedPanelVariant.value
  const currentPanelId = panelVar && 'id' in panelVar ? panelVar.id : null
  if (!appState || currentPanelId === item.id) {
    selectByClick(item)
    selectedVariantId.value = item.id
  }
  emit('row-click', item)
}

// KeepAlive: disable keyboard handlers when this view is cached but not active
onActivated(() => {
  viewActive.value = true
})
onDeactivated(() => {
  viewActive.value = false
})

// Keyboard navigation handlers
const lastKeyboardMoveAtMs = ref<number | null>(null)
const pendingScrollBehavior = ref<ScrollBehavior>('smooth')

for (const [key, move] of [
  ['ArrowDown', moveDown],
  ['ArrowUp', moveUp]
] as const) {
  onKeyStroke(
    key,
    (e: KeyboardEvent) => {
      if (!props.interactive || !viewActive.value || isInputFocused()) return
      e.preventDefault()
      const now = performance.now()
      pendingScrollBehavior.value = getAdaptiveRowScrollBehavior(lastKeyboardMoveAtMs.value, now)
      lastKeyboardMoveAtMs.value = now
      move()
      liveSync.schedule()
    },
    { dedupe: true }
  )
}

onKeyStroke(
  SHORTCUTS.openDetails.key,
  (e: KeyboardEvent) => {
    if (!props.interactive || !viewActive.value || isInputFocused()) return
    if (selectedItem.value === null || isControlFocused()) return
    e.preventDefault()
    emit('row-click', selectedItem.value)
  },
  { dedupe: true }
)

onKeyStroke(
  SHORTCUTS.closeDetails.key,
  (e: KeyboardEvent) => {
    if (e.defaultPrevented || !props.interactive || !viewActive.value || isInputFocused()) return
    if (appState?.panelOpen.value === true) {
      e.preventDefault()
      appState.panelOpen.value = false
      return
    }
    bulkSelection.clearSelection()
    clearSelection()
    selectedVariantId.value = null
    emit('deselect')
  },
  { dedupe: true }
)

// Action shortcuts on selected row (bare letters only: Ctrl/Cmd/Alt+key
// belongs to the browser, see hasCommandModifier)
const rowActionKeys: Record<string, (item: NonNullable<typeof selectedItem.value>) => void> = {
  [SHORTCUTS.star.key]: (item) => annotationDialogsRef.value?.handleStarToggle(item),
  [SHORTCUTS.comment.key]: (item) => annotationDialogsRef.value?.openCommentDialog(item),
  [SHORTCUTS.acmg.key]: (item) => annotationDialogsRef.value?.openAcmgEvidenceDialog(item)
}
for (const [key, action] of Object.entries(rowActionKeys)) {
  onKeyStroke(
    key,
    (e: KeyboardEvent) => {
      if (hasCommandModifier(e) || !props.interactive || !viewActive.value || isInputFocused())
        return
      if (selectedItem.value === null) return
      e.preventDefault()
      action(selectedItem.value)
    },
    { dedupe: true }
  )
}

useProteinViewShortcut(() => (tableWorkActive.value ? selectedItem.value : null))

// Scroll selected row into view
watch(selectedIndex, async (newIndex) => {
  if (newIndex === null) return
  await nextTick()
  const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
  const row = tableEl?.querySelectorAll('tbody tr')[newIndex] as HTMLElement | undefined
  row?.scrollIntoView({ block: 'nearest', behavior: pendingScrollBehavior.value })
  pendingScrollBehavior.value = 'smooth'
})

// Setup scroll sync after mount
onMounted(async () => {
  if (isWebRuntime() && api?.variants.onAnnotationChanged !== undefined) {
    cleanupAnnotationChanged = api.variants.onAnnotationChanged((event: AnnotationChangeEvent) => {
      if (event.caseId !== props.caseId || !hasAnnotationBackedFilters.value) return
      handleAnnotationChanged()
    })
  }

  await nextTick()
  const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
  if (tableEl) {
    const tableWrapperEl = tableEl.querySelector('.v-table__wrapper') as HTMLElement | null
    if (tableWrapperEl) initScrollSync(tableWrapperEl)
  }
})

onUnmounted(() => {
  cleanupAnnotationChanged?.()
})

defineExpose({
  resetSort,
  refresh: loadVariants,
  buildQueryFilters,
  columns: computed(() => headers.value.map(({ key, title, width }) => ({ key, title, width }))),
  hasColumnFilters,
  columnFilterCount,
  clearAllColumnFilters,
  clearColumnFilter,
  columnActiveFilters
})
</script>

<style src="./data-table-shared.css"></style>
