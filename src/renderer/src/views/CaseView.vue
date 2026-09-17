<script setup lang="ts">
import { ref, computed, onActivated, watch } from 'vue'
import { mdiStarFourPoints } from '@mdi/js'
import type { ColumnFilterMeta } from '../../../shared/types/column-filters'
import type { AnnotationScope } from '../../../shared/types/annotations'
import type { VisibleTab, PerTypeTab } from '../../../shared/types/shortlist'
import EmptyState from '../components/EmptyState.vue'
import FilterToolbar from '../components/FilterToolbar.vue'
import VariantTable from '../components/VariantTable.vue'
import ShortlistPanel from '../components/shortlist/ShortlistPanel.vue'
import ProbandContextBanner from '../components/case/ProbandContextBanner.vue'
import { useAppState } from '../composables/useAppState'
import type { VariantFilter, Variant } from '../../../shared/types/api'
import { APP_CONFIG } from '../../../shared/config/app.config'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import { logService } from '../services/LogService'
import { useApiService } from '../composables/useApiService'
import { useSettingsStore } from '../stores/settingsStore'

const {
  selectedCaseId,
  selectedCaseName,
  currentFilters,
  filteredCount,
  totalCount,
  hasSort,
  initialSearch,
  caseCount,
  sidebarOpen,
  filterToolbarRef,
  variantTableRef,
  panelOpen,
  selectedPanelVariant,
  showSnack,
  dataGeneration,
  openCaseMetadata
} = useAppState()

const { api } = useApiService()
const settingsStore = useSettingsStore()
const hasCases = computed(() => caseCount.value > 0)

// ── Variant type tabs ─────────────────────────────────────────

/**
 * Single display-row descriptor used by `v-tabs`. `count` is `null` for
 * the synthetic Shortlist tab (it has no single row count) and a number
 * for every real per-type tab. `icon` is optional; only Shortlist uses
 * it today.
 */
interface TabItem {
  type: VisibleTab
  label: string
  count: number | null
  icon?: string
}

/**
 * Returns the per-type tabs that should be shown for this case, in the
 * canonical display order (snv → sv → cnv → str). Folds `indel` into
 * `snv` because the UI presents them as a single "SNV/Indel" tab.
 *
 * Shared between `tabItems` (display) and `loadTypeCounts`
 * (default-selection) because SNV/indel folding is domain logic, not a
 * display-layer concern — keeping a single helper prevents the two
 * consumers from drifting.
 */
function getPresentTabTypes(counts: Record<string, number>): PerTypeTab[] {
  const present: PerTypeTab[] = []
  if ((counts.snv ?? 0) + (counts.indel ?? 0) > 0) present.push('snv')
  if ((counts.sv ?? 0) > 0) present.push('sv')
  if ((counts.cnv ?? 0) > 0) present.push('cnv')
  if ((counts.str ?? 0) > 0) present.push('str')
  return present
}

/**
 * The currently visible tab in the case view. Narrowed to `VisibleTab`
 * so TypeScript rejects any attempt to pass `'shortlist'` into
 * filter/query code that only accepts real DB variant types.
 */
const selectedVariantType = ref<VisibleTab>('snv')

/**
 * Tracks the last non-shortlist tab the user (or the default-selection
 * rule) picked. When the Shortlist tab is active, this is the tab the
 * VariantTable underneath the `v-show` layer is still bound to — so
 * toggling Shortlist → per-type → Shortlist returns to a still-warm
 * table without a reload.
 */
const lastNonShortlistType = ref<PerTypeTab>('snv')

watch(selectedVariantType, (next) => {
  if (next !== 'shortlist') {
    lastNonShortlistType.value = next
  }
})

/**
 * The variant-type the VariantTable component should be bound to. When
 * the Shortlist tab is active, VariantTable is hidden via `v-show` but
 * still mounted — we feed it `lastNonShortlistType` so the filter-prop
 * identity stays stable and `useVariantData`'s serialized-filter watcher
 * does NOT invalidate cached state when the user toggles Shortlist on
 * and off.
 */
const variantTableType = computed<PerTypeTab>(() =>
  selectedVariantType.value === 'shortlist' ? lastNonShortlistType.value : selectedVariantType.value
)

const typeCounts = ref<Record<string, number>>({})

/**
 * True once `loadTypeCounts` has resolved with at least one count key.
 * `{}` is the not-yet-loaded sentinel; any populated record means the
 * IPC round-trip finished. Drives the deferred FilterToolbar mount.
 */
const typeCountsLoaded = computed(() => Object.keys(typeCounts.value).length > 0)

/**
 * Pass-9 #3 (Sprint A A3): deferred FilterToolbar mount. Flips true the
 * first time type counts have loaded AND we are not sitting on the
 * Shortlist tab — i.e. a per-type table is actually showing. Once true
 * it never resets, so the user can toggle freely between a per-type tab
 * and Shortlist without remounting the FilterToolbar (which would re-run
 * its `loadFilterOptions` IPC). The outer per-type region stays on
 * `v-show` so VariantTable selection/scroll/expansion survive the toggle.
 */
const firstActivated = ref(false)

watch(
  [typeCountsLoaded, selectedVariantType],
  ([loaded, type]) => {
    if (loaded && type !== 'shortlist' && !firstActivated.value) {
      firstActivated.value = true
    }
  },
  { immediate: true }
)

async function loadTypeCounts(caseId: number | null): Promise<void> {
  if (caseId === null || caseId === 0 || api === undefined) {
    typeCounts.value = {}
    return
  }
  try {
    typeCounts.value = unwrapIpcResult(await api.variants.typeCounts(caseId))
  } catch (error) {
    logService.error(
      'Failed to load variant type counts: ' +
        (isIpcError(error)
          ? (error.userMessage ?? error.message)
          : error instanceof Error
            ? error.message
            : String(error)),
      'case'
    )
    typeCounts.value = {}
    return
  }

  // Default-selection rule: if the caller hasn't explicitly picked a
  // tab yet (`selectedVariantType.value === 'snv'` is the reset sentinel
  // set by the case watcher below), consult the user preference
  // `settingsStore.defaultCaseTab`:
  //
  //   • 'shortlist' (default) → land on Shortlist AND seed
  //     `lastNonShortlistType` to the first present real type so the
  //     hidden VariantTable preloads with meaningful data (not a stale
  //     'snv' bind on a cnv+str or sv-only case).
  //   • 'snv' → land on the first present per-type tab. When the case
  //     has no SNV/indel we land on whichever type IS present, which
  //     preserves the "open the non-empty tab" behavior the app had
  //     before the Shortlist feature.
  //
  // Empty case (no variants) → leave the sentinel `'snv'` default.
  const presentTypes = getPresentTabTypes(typeCounts.value)

  if (selectedVariantType.value === 'snv' && presentTypes.length >= 1) {
    // Always seed `lastNonShortlistType` regardless of preference so
    // toggling Shortlist → per-type → Shortlist works without a stale
    // VariantTable bind on sv-only / cnv+str cases.
    lastNonShortlistType.value = presentTypes[0]

    if (settingsStore.defaultCaseTab === 'shortlist') {
      selectedVariantType.value = 'shortlist'
    } else {
      // 'snv' preference: land on the first present real type.
      selectedVariantType.value = presentTypes[0]
    }
  }
}

// Load counts on case change
watch(
  selectedCaseId,
  (newCaseId) => {
    // Reset to the conventional default; loadTypeCounts may override this
    // after the counts resolve if the case has zero SNV/indel variants.
    selectedVariantType.value = 'snv'
    void loadTypeCounts(newCaseId)
  },
  { immediate: true }
)

// Tab items — shortlist tab prepended whenever at least one real variant
// type is present. The Shortlist has two reasons to exist:
//   (1) cross-type comparison in a single ranked view, and
//   (2) algorithmic ranking of best variants regardless of type count.
// Reason (2) means the tab is valuable on single-type cases too, so we
// gate on `>= 1` present types, not `> 1`.
const tabItems = computed<TabItem[]>(() => {
  const counts = typeCounts.value
  const presentTypes = getPresentTabTypes(counts)
  const snvCount = (counts.snv ?? 0) + (counts.indel ?? 0)
  const items: TabItem[] = []

  if (presentTypes.length >= 1) {
    // `mdiStarFourPoints` from @mdi/js — four-point star reads as
    // "curated / featured / best-of" in clinical dashboards without the
    // awards-ceremony feel of `mdi-star-circle`. The icon field stores
    // the SVG path directly because Vuetify's `mdi-svg` iconset expects
    // a path string, not a CSS class name.
    items.push({ type: 'shortlist', label: 'Shortlist', count: null, icon: mdiStarFourPoints })
  }

  if (presentTypes.includes('snv')) {
    items.push({ type: 'snv', label: 'SNV/Indel', count: snvCount })
  }
  if ((counts.sv ?? 0) > 0) items.push({ type: 'sv', label: 'SV', count: counts.sv! })
  if ((counts.cnv ?? 0) > 0) items.push({ type: 'cnv', label: 'CNV', count: counts.cnv! })
  if ((counts.str ?? 0) > 0) items.push({ type: 'str', label: 'STR', count: counts.str! })

  return items
})

const showVariantTypeTabs = computed(() => tabItems.value.length > 1)

// Effective filters include variant_type from `variantTableType` (NOT
// `selectedVariantType`) — load-bearing: the filter prop seen by
// VariantTable must never be `'shortlist'`, and it must stay stable
// across Shortlist toggles so `useVariantData`'s serialized-filter
// watcher doesn't invalidate cached state.
const effectiveFilters = computed<Omit<VariantFilter, 'case_id'>>(() => ({
  ...currentFilters.value,
  variant_type: variantTableType.value
}))

// Refresh type counts when data changes (import, delete)
watch(dataGeneration, () => {
  if (selectedCaseId.value !== null && selectedCaseId.value !== 0) {
    void loadTypeCounts(selectedCaseId.value)
  }
})

// KeepAlive stale data detection: refresh if data changed while view was cached
const lastSeenGeneration = ref(dataGeneration.value)
onActivated(async () => {
  if (dataGeneration.value !== lastSeenGeneration.value) {
    lastSeenGeneration.value = dataGeneration.value
    if (selectedCaseId.value != null) {
      try {
        await variantTableRef.value?.refresh()
      } catch (error) {
        logService.error(
          'Failed to refresh variant table on activation: ' +
            (error instanceof Error ? error.message : String(error)),
          'case'
        )
      }
    }
  }
})
const annotationScope = ref<AnnotationScope>('case')

// Pipe columnMeta from FilterToolbar (single owner of filter options) to VariantTable
// filterOptions is exposed as Ref<FilterOptions> from FilterToolbar; Vue template refs
// auto-unwrap refs from defineExpose, so .columnMeta is directly accessible.
const columnMeta = computed<ColumnFilterMeta[]>(
  () => filterToolbarRef.value?.filterOptions?.columnMeta ?? []
)

function handleImportClick(): void {
  // Delegate to parent App.vue via event bus or direct ref
  // For now, emit - App.vue will handle
  sidebarOpen.value = true
}

function handleFiltersUpdate(filters: Omit<VariantFilter, 'case_id'>): void {
  currentFilters.value = filters
  annotationScope.value = (filters.annotation_scope as AnnotationScope) ?? 'case'
  if (initialSearch.value !== undefined && filters.search_query != null) {
    initialSearch.value = undefined
  }
}

function handleResetSort(): void {
  variantTableRef.value?.resetSort()
}

function handleCountsUpdate(counts: { filtered: number; total: number }): void {
  filteredCount.value = counts.filtered
  totalCount.value = counts.total
}

function handleSortUpdate(sortActive: boolean): void {
  hasSort.value = sortActive
}

function handleRowClick(variant: Variant): void {
  selectedPanelVariant.value = variant
  panelOpen.value = true
}

function handleDeselect(): void {
  if (panelOpen.value) {
    panelOpen.value = false
  }
}

function handleExportSuccess(data: {
  filePath: string
  action: { text: string; callback: () => void }
}): void {
  showSnack(`Exported to ${data.filePath}`, 'success', {
    timeout: APP_CONFIG.SNACKBAR_SUCCESS_MS,
    action: data.action
  })
}

function handleExportError(error: string): void {
  showSnack(`Export failed: ${error}`, 'error', { timeout: APP_CONFIG.SNACKBAR_ERROR_MS })
}

function handleClearColumnFilters(): void {
  variantTableRef.value?.clearAllColumnFilters()
}

function handleClearColumnFilter(columnKey: string): void {
  variantTableRef.value?.clearColumnFilter(columnKey)
}

// filterToolbarRef is used as template ref (not detected by vue-tsc from destructured composable)
void filterToolbarRef

defineExpose({
  handleImportClick,
  // Exposed for unit tests — lets `CaseView.test.ts` drive and assert
  // tab-selection state without reaching into component internals.
  selectedVariantType,
  lastNonShortlistType,
  variantTableType,
  tabItems
})
</script>

<template>
  <EmptyState
    v-if="!selectedCaseId"
    :has-cases="hasCases"
    :allow-import="true"
    @import="handleImportClick"
  />
  <div v-else class="case-content">
    <!-- Variant type tabs (only shown when case has SV/CNV/STR data or Shortlist) -->
    <v-tabs
      v-if="showVariantTypeTabs"
      v-model="selectedVariantType"
      color="primary"
      density="compact"
      class="variant-type-tabs"
    >
      <v-tab
        v-for="item in tabItems"
        :key="item.type"
        :value="item.type"
        :class="{ 'shortlist-tab': item.type === 'shortlist' }"
      >
        <v-icon v-if="item.icon" start size="small" color="primary" :icon="item.icon" />
        {{ item.label }}
        <v-chip v-if="item.count !== null" size="x-small" class="ml-2" variant="tonal">
          {{ item.count }}
        </v-chip>
      </v-tab>
    </v-tabs>

    <!-- Persistent Proband & Phenotype Context Banner -->
    <ProbandContextBanner
      :case-id="selectedCaseId"
      :case-name="selectedCaseName"
      @edit="openCaseMetadata"
    />

    <!--
      Per-type region. `v-show` (not `v-if`) because VariantTable is
      kept alive while the Shortlist tab is active so the user can
      toggle between Shortlist and a per-type tab without losing
      selection / scroll / expansion state. The `:interactive` prop
      gates the hidden VariantTable's global keyboard shortcuts so
      they don't fire while the Shortlist panel is showing.
    -->
    <div v-show="selectedVariantType !== 'shortlist'" class="per-type-region">
      <div class="filter-bar-container">
        <!--
          Pass-9 #3: deferred mount. FilterToolbar is gated on
          `firstActivated` so its `loadFilterOptions` IPC does not fire
          until type counts arrive on a per-type tab. The outer region
          stays on `v-show` (above) so VariantTable state is preserved.
        -->
        <FilterToolbar
          v-if="firstActivated"
          ref="filterToolbarRef"
          :case-id="selectedCaseId"
          :case-name="selectedCaseName"
          :filtered-count="filteredCount"
          :total-count="totalCount"
          :has-sort="hasSort"
          :initial-search="initialSearch"
          :columns="variantTableRef?.columns"
          :column-active-filters="variantTableRef?.columnActiveFilters"
          @update:filters="handleFiltersUpdate"
          @reset-sort="handleResetSort"
          @export-success="handleExportSuccess"
          @export-error="handleExportError"
          @clear-column-filters="handleClearColumnFilters"
          @clear-column-filter="handleClearColumnFilter"
        />
      </div>
      <VariantTable
        ref="variantTableRef"
        :case-id="selectedCaseId"
        :filters="effectiveFilters"
        :variant-type="variantTableType"
        :annotation-scope="annotationScope"
        :column-meta="columnMeta"
        :interactive="selectedVariantType !== 'shortlist'"
        @update:counts="handleCountsUpdate"
        @update:has-sort="handleSortUpdate"
        @row-click="handleRowClick"
        @deselect="handleDeselect"
        @clear-filters="filterToolbarRef?.handleClearAll()"
      />
    </div>

    <!--
      Shortlist region. `v-if` (not `v-show`) so the panel is
      mounted on demand — it owns its own query lifecycle via
      `useShortlistQuery` and we don't want to pay that cost on cases
      where the user never opens the tab. `ShortlistRow` extends
      `ShortlistCandidate` extends `Variant` so the `row-click` payload
      is structurally a `Variant` and `handleRowClick` accepts it with
      zero coercion.
    -->
    <ShortlistPanel
      v-if="selectedVariantType === 'shortlist' && selectedCaseId !== null"
      :case-id="selectedCaseId"
      class="shortlist-region"
      @row-click="handleRowClick"
      @open-in-tab="
        (t) => {
          selectedVariantType = t
        }
      "
    />
  </div>
</template>

<style scoped>
.filter-bar-container {
  background: rgb(var(--v-theme-surface));
}

.case-content {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px - 32px);
  overflow: hidden;
}

.variant-type-tabs {
  border-bottom: 1px solid rgb(var(--v-theme-outline));
  background: rgb(var(--v-theme-surface));
  flex: 0 0 auto;
}

.variant-type-tabs :deep(.v-tab) {
  min-height: 36px;
  text-transform: none;
  font-weight: 500;
}

/*
 * The Shortlist tab is categorically different from the per-type tabs
 * (algorithmic cross-type ranking vs. raw table), so it should be
 * distinguishable at a glance — but this is a clinical UI, so we signal
 * hierarchy through restraint, not color. The treatment draws on
 * Material 3's "accent border" pattern and clinical-dashboard
 * conventions (signal specialness via typography + a single accent
 * mark, not background washes):
 *
 *   - A 3px leading accent bar in the theme `primary` (slate navy).
 *     This is the whole featured-tab signal — no background tint, no
 *     custom text color, no amber.
 *   - Font weight bumped to 600 (vs 500 default). Subtle but reads as
 *     "emphasized".
 *   - A 1px right-border separator + a few pixels of margin visually
 *     groups the Shortlist tab as a category distinct from the raw
 *     per-type tabs that follow.
 *   - The icon itself is colored via the template `color="primary"`
 *     binding — no additional CSS needed for hover/selected states
 *     since everything inherits from the base v-tab styling.
 *
 * CLAUDE.md forbids `surface-variant` backgrounds. This rule uses no
 * background at all — the accent bar + typography carry the whole
 * signal.
 */
.variant-type-tabs :deep(.v-tab.shortlist-tab) {
  font-weight: 600;
  letter-spacing: 0.01em;
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  border-radius: 6px;
  margin-right: 6px;
  border-right: 1px solid rgba(var(--v-theme-outline), 0.3);
}

.variant-type-tabs :deep(.v-tab.shortlist-tab.v-tab--selected) {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 14%, transparent);
}

/*
 * Per-type region wraps the FilterToolbar + VariantTable. It must fill
 * the remaining vertical space of `.case-content` so VariantTable's
 * internal scroller sizes correctly, exactly like it did before the
 * wrapper was introduced.
 */
.per-type-region {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.shortlist-region {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
