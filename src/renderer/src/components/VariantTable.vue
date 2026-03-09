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
                  <v-icon size="small">
                    {{ hasColumnFilter(col.key) ? 'mdi-filter' : 'mdi-filter-outline' }}
                  </v-icon>
                  <v-tooltip activator="parent" location="bottom">Filter this column</v-tooltip>
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
import { ref, watch, computed, onMounted, nextTick } from 'vue'
import type {
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem
} from '../../../shared/types/api'
import { useExternalLinksStore, type ExternalLinkConfig } from '../stores/externalLinksStore'
import { useSettingsStore } from '../stores/settingsStore'
import { resolveUrlTemplate, buildOmimUrl, type VariantLinkData } from '../utils/externalLinks'
import { useAnnotations } from '../composables/useAnnotations'
import type { AcmgClassification } from '../../../main/database/types'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { useColumnFilters } from '../composables/useColumnFilters'
import { useDebounce } from '../composables/useDebounce'
import { formatConsequence } from '../utils/formatters'
import { useTableScroll } from '../composables/useTableScroll'
import { APP_CONFIG } from '../../../shared/config'
import CommentDialog from './CommentDialog.vue'
import AcmgEvidenceDialog from './AcmgEvidenceDialog.vue'
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

const itemsPerPageOptions = [...APP_CONFIG.ITEMS_PER_PAGE_OPTIONS]

const emit = defineEmits<{
  'update:counts': [counts: { filtered: number; total: number }]
  'update:hasSort': [hasSort: boolean]
  'row-click': [variant: Variant]
}>()

// Initialize stores
const linksStore = useExternalLinksStore()
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

// Snackbar state for error feedback
const snackbar = ref({
  visible: false,
  message: '',
  color: 'error'
})

// Comment dialog state
const commentDialogOpen = ref(false)
const selectedVariantForComment = ref<Variant | null>(null)

// ACMG evidence dialog state
const acmgEvidenceDialogRef = ref<InstanceType<typeof AcmgEvidenceDialog> | null>(null)
const selectedVariantForAcmg = ref<Variant | null>(null)

const acmgEvidenceJson = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return null
  return getAcmgEvidence(v.chr, v.pos, v.ref, v.alt)
})

const acmgVariantData = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return null
  return {
    gnomad_af: v.gnomad_af ?? null,
    cadd: v.cadd ?? null,
    clinvar: v.clinvar ?? null
  }
})

const acmgVariantLabel = computed(() => {
  const v = selectedVariantForAcmg.value
  if (v === null) return ''
  return `${v.chr}:${v.pos} ${v.ref}>${v.alt}${v.gene_symbol !== null ? ` (${v.gene_symbol})` : ''}`
})

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

// Helper functions for link resolution
const getVariantLinkData = (item: Variant): VariantLinkData => ({
  chr: item.chr,
  pos: item.pos,
  ref: item.ref,
  alt: item.alt,
  gene_symbol: item.gene_symbol ?? null,
  mim_number: item.omim_mim_number ?? null
})

const buildOmimEntryUrl = (mimNumber: string | null): string | null => {
  return buildOmimUrl(mimNumber)
}

const resolveLink = (linkId: string, item: Variant): string | null => {
  const link = linksStore.enabledLinks.find((l) => l.id === linkId)
  if (link === undefined) return null
  return resolveUrlTemplate(
    link.urlTemplate,
    getVariantLinkData(item),
    linksStore.genomeBuild,
    link.requiredFields
  )
}

const getLinkForColumn = (column: string): ExternalLinkConfig | null => {
  return linksStore.enabledLinks.find((l) => l.column === column) ?? null
}

// Open external link with visual feedback and error handling
const openExternalLink = async (url: string, event?: MouseEvent): Promise<void> => {
  if (!url) return

  // Brief highlight on clicked element
  const target = event?.currentTarget as HTMLElement
  if (target !== null && target !== undefined) {
    target.classList.add('external-link--clicked')
    // eslint-disable-next-line no-undef
    setTimeout(() => target.classList.remove('external-link--clicked'), 200)
  }

  // eslint-disable-next-line no-undef
  if (typeof window.api !== 'undefined') {
    try {
      // eslint-disable-next-line no-undef
      const result = await window.api.shell.openExternal(url)
      if (!result.success) {
        snackbar.value = { visible: true, message: 'Could not open link', color: 'error' }
      }
    } catch (error) {
      // eslint-disable-next-line no-undef
      console.error('Failed to open external link:', error)
      snackbar.value = { visible: true, message: 'Could not open link', color: 'error' }
    }
  }
}

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

// Handle star toggle (per-case)
const handleStarToggle = async (item: Variant): Promise<void> => {
  await toggleStar(props.caseId, item.id, item.chr, item.pos, item.ref, item.alt)
}

// Open comment dialog for variant
const openCommentDialog = (item: Variant) => {
  selectedVariantForComment.value = item
  commentDialogOpen.value = true
}

// Quick ACMG classification (no evidence, just set the classification)
const handleQuickAcmgSelect = async (
  item: Variant,
  classification: AcmgClassification | null
): Promise<void> => {
  await setAcmgClassification(
    props.caseId,
    item.id,
    item.chr,
    item.pos,
    item.ref,
    item.alt,
    classification
  )
}

// Open ACMG evidence dialog for a variant
const openAcmgEvidenceDialog = (item: Variant): void => {
  selectedVariantForAcmg.value = item
  nextTick(() => {
    acmgEvidenceDialogRef.value?.open()
  })
}

// Handle ACMG evidence change from dialog
const handleAcmgEvidenceChange = async (payload: {
  classification: AcmgClassification | null
  evidenceJson: string
}): Promise<void> => {
  const v = selectedVariantForAcmg.value
  if (v === null) return
  await setAcmgClassificationWithEvidence(
    props.caseId,
    v.id,
    v.chr,
    v.pos,
    v.ref,
    v.alt,
    payload.classification,
    payload.evidenceJson
  )
}

// Handle comment save
const handleCommentSave = async (data: {
  globalComment: string | null
  perCaseComment: string | null
  globalChanged: boolean
  perCaseChanged: boolean
}): Promise<void> => {
  if (!selectedVariantForComment.value) return
  const v = selectedVariantForComment.value

  if (data.globalChanged) {
    await upsertGlobalComment(v.chr, v.pos, v.ref, v.alt, data.globalComment)
  }
  if (data.perCaseChanged) {
    await upsertPerCaseComment(props.caseId, v.id, v.chr, v.pos, v.ref, v.alt, data.perCaseComment)
  }

  commentDialogOpen.value = false
}

// Get timestamps from cache
const getGlobalTimestamps = (
  item: Variant | null
): { created_at: number; updated_at: number } | null => {
  if (!item) return null
  const annotations = getAnnotations(item.chr, item.pos, item.ref, item.alt)
  if (!annotations?.global) return null
  return { created_at: annotations.global.created_at, updated_at: annotations.global.updated_at }
}

const getPerCaseTimestamps = (
  item: Variant | null
): { created_at: number; updated_at: number } | null => {
  if (!item) return null
  const annotations = getAnnotations(item.chr, item.pos, item.ref, item.alt)
  if (!annotations?.perCase) return null
  return { created_at: annotations.perCase.created_at, updated_at: annotations.perCase.updated_at }
}

// Load variants from backend
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadVariants = async (_options?: any): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
      const result = await (window as any).api.variants.query(newCaseId, {}, undefined, 1, [])
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
