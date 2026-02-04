<template>
  <div class="table-container">
    <!-- Top scrollbar (synced with table) -->
    <div ref="topScrollbarRef" class="top-scrollbar-container" @scroll="handleTopScroll">
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
      :items-per-page-options="[25, 50, 100]"
      density="compact"
      multi-sort
      class="elevation-1"
      @update:options="loadVariants"
      @click:row="(_event: unknown, { item }: { item: Variant }) => emit('row-click', item)"
    >
      <!-- Annotations column (star, ACMG, comment) -->
      <template #[`item.annotations`]="{ item }">
        <div class="d-flex align-center ga-1">
          <!-- Star toggle (per-case, with global indicator ring) -->
          <v-tooltip location="top">
            <template #activator="{ props: tooltipProps }">
              <span
                v-bind="tooltipProps"
                class="annotation-icon-wrapper"
                :class="{ 'has-global': isGlobalStarred(item.chr, item.pos, item.ref, item.alt) }"
              >
                <v-icon
                  :icon="
                    isStarred(item.chr, item.pos, item.ref, item.alt)
                      ? 'mdi-star'
                      : 'mdi-star-outline'
                  "
                  :color="
                    isStarred(item.chr, item.pos, item.ref, item.alt) ? 'amber' : 'grey-lighten-1'
                  "
                  size="small"
                  class="cursor-pointer"
                  @click.stop="handleStarToggle(item)"
                />
              </span>
            </template>
            <span
              v-if="
                isGlobalStarred(item.chr, item.pos, item.ref, item.alt) &&
                isStarred(item.chr, item.pos, item.ref, item.alt)
              "
            >
              Starred (case + global)
            </span>
            <span v-else-if="isGlobalStarred(item.chr, item.pos, item.ref, item.alt)">
              Global star (click to add case star)
            </span>
            <span v-else-if="isStarred(item.chr, item.pos, item.ref, item.alt)">
              Starred for this case
            </span>
            <span v-else>Click to star</span>
          </v-tooltip>
          <!-- ACMG classification (per-case, with global indicator border) -->
          <AcmgMenu @select="(c) => handleAcmgSelect(item, c)">
            <template #activator="{ props: menuProps }">
              <v-tooltip location="top">
                <template #activator="{ props: tooltipPropsAcmg }">
                  <span
                    v-bind="{ ...menuProps, ...tooltipPropsAcmg }"
                    class="annotation-icon-wrapper"
                    :class="{
                      'has-global': getGlobalAcmgClassification(
                        item.chr,
                        item.pos,
                        item.ref,
                        item.alt
                      )
                    }"
                  >
                    <v-chip
                      v-if="getAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
                      :color="
                        ACMG_COLORS[getAcmgClassification(item.chr, item.pos, item.ref, item.alt)!]
                      "
                      size="x-small"
                      label
                      class="cursor-pointer"
                    >
                      {{
                        ACMG_ABBREV[getAcmgClassification(item.chr, item.pos, item.ref, item.alt)!]
                      }}
                    </v-chip>
                    <v-icon
                      v-else
                      icon="mdi-tag-plus-outline"
                      size="small"
                      color="grey-lighten-1"
                      class="cursor-pointer"
                    />
                  </span>
                </template>
                <span
                  v-if="
                    getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt) &&
                    getAcmgClassification(item.chr, item.pos, item.ref, item.alt)
                  "
                >
                  Case: {{ getAcmgClassification(item.chr, item.pos, item.ref, item.alt) }}<br />
                  Global: {{ getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt) }}
                </span>
                <span
                  v-else-if="getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
                >
                  Global: {{ getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)
                  }}<br />
                  (click to set case classification)
                </span>
                <span v-else-if="getAcmgClassification(item.chr, item.pos, item.ref, item.alt)">
                  {{ getAcmgClassification(item.chr, item.pos, item.ref, item.alt) }}
                </span>
                <span v-else>Set ACMG classification</span>
              </v-tooltip>
            </template>
          </AcmgMenu>
          <!-- Comment (with global indicator) -->
          <v-tooltip location="top">
            <template #activator="{ props: tooltipProps }">
              <span
                v-bind="tooltipProps"
                class="annotation-icon-wrapper"
                :class="{ 'has-global': getGlobalComment(item.chr, item.pos, item.ref, item.alt) }"
              >
                <v-icon
                  :icon="hasAnyComment(item) ? 'mdi-comment-text' : 'mdi-comment-text-outline'"
                  :color="hasAnyComment(item) ? 'primary' : 'grey-lighten-1'"
                  size="small"
                  class="cursor-pointer"
                  @click.stop="openCommentDialog(item)"
                />
              </span>
            </template>
            <span
              v-if="
                getGlobalComment(item.chr, item.pos, item.ref, item.alt) &&
                getPerCaseComment(item.chr, item.pos, item.ref, item.alt)
              "
            >
              Has global + case comments
            </span>
            <span v-else-if="getGlobalComment(item.chr, item.pos, item.ref, item.alt)">
              Has global comment
            </span>
            <span v-else-if="getPerCaseComment(item.chr, item.pos, item.ref, item.alt)">
              Has case comment
            </span>
            <span v-else>Add comment</span>
          </v-tooltip>
        </div>
      </template>

      <!-- Chromosome with dynamic link from store -->
      <template #[`item.chr`]="{ item, value }">
        <span
          v-if="getLinkForColumn('chr') && resolveLink(getLinkForColumn('chr')!.id, item)"
          class="external-link"
          @click="openExternalLink(resolveLink(getLinkForColumn('chr')!.id, item)!, $event)"
        >
          {{ value }}
          <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
        </span>
        <span v-else>{{ value }}</span>
      </template>

      <!-- Position with thousand separators and dynamic link from store -->
      <template #[`item.pos`]="{ item, value }">
        <span
          v-if="getLinkForColumn('pos') && resolveLink(getLinkForColumn('pos')!.id, item)"
          class="external-link genomic-coordinate"
          @click="openExternalLink(resolveLink(getLinkForColumn('pos')!.id, item)!, $event)"
        >
          {{ formatPosition(value) }}
          <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
        </span>
        <span v-else class="genomic-coordinate">{{ formatPosition(value) }}</span>
      </template>

      <!-- gnomAD AF in scientific notation -->
      <template #[`item.gnomad_af`]="{ value }">
        {{ formatScientific(value) }}
      </template>

      <!-- ClinVar colored chips with dynamic link from store -->
      <template #[`item.clinvar`]="{ item, value }">
        <span
          v-if="
            value &&
            getLinkForColumn('clinvar') &&
            resolveLink(getLinkForColumn('clinvar')!.id, item)
          "
          class="external-link"
          @click="openExternalLink(resolveLink(getLinkForColumn('clinvar')!.id, item)!, $event)"
        >
          <v-chip :color="getClinVarColor(value)" size="small" label>
            {{ value.replace(/_/g, ' ') }}
          </v-chip>
          <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
        </span>
        <v-chip v-else-if="value" :color="getClinVarColor(value)" size="small" label>
          {{ value.replace(/_/g, ' ') }}
        </v-chip>
        <span v-else class="text-grey">--</span>
      </template>

      <!-- Ref allele with truncation and tooltip -->
      <template #[`item.ref`]="{ value }">
        <v-tooltip v-if="value.length > 20" location="top">
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps" class="text-truncate allele-cell variant-data-mono">
              {{ value.substring(0, 20) }}...
            </span>
          </template>
          <span class="variant-data-mono">{{ value }}</span>
        </v-tooltip>
        <span v-else class="variant-data-mono">{{ value }}</span>
      </template>

      <!-- Alt allele with truncation and tooltip -->
      <template #[`item.alt`]="{ value }">
        <v-tooltip v-if="value.length > 20" location="top">
          <template #activator="{ props: tooltipProps }">
            <span v-bind="tooltipProps" class="text-truncate allele-cell variant-data-mono">
              {{ value.substring(0, 20) }}...
            </span>
          </template>
          <span class="variant-data-mono">{{ value }}</span>
        </v-tooltip>
        <span v-else class="variant-data-mono">{{ value }}</span>
      </template>

      <!-- CADD score (handle null) -->
      <template #[`item.cadd`]="{ value }">
        {{ value !== null ? value.toFixed(1) : '-' }}
      </template>

      <!-- Gene symbol with dynamic link from store -->
      <template #[`item.gene_symbol`]="{ item, value }">
        <span
          v-if="
            value &&
            getLinkForColumn('gene_symbol') &&
            resolveLink(getLinkForColumn('gene_symbol')!.id, item)
          "
          class="external-link gene-symbol"
          @click="openExternalLink(resolveLink(getLinkForColumn('gene_symbol')!.id, item)!, $event)"
        >
          {{ value }}
          <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
        </span>
        <span v-else class="gene-symbol">{{ value ?? '--' }}</span>
      </template>

      <!-- OMIM MIM number with clickable link to OMIM entry -->
      <template #[`item.omim_mim_number`]="{ value }">
        <span
          v-if="value && buildOmimEntryUrl(value)"
          class="external-link"
          @click="openExternalLink(buildOmimEntryUrl(value)!, $event)"
        >
          {{ value }}
          <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
        </span>
        <span v-else class="text-grey">&mdash;</span>
      </template>

      <!-- Consequence (handle null) -->
      <template #[`item.consequence`]="{ value }">
        {{ (value ?? null) !== null ? value.replace(/_/g, ' ') : '-' }}
      </template>

      <!-- GT (handle null) -->
      <template #[`item.gt_num`]="{ value }">
        {{ value ?? '-' }}
      </template>

      <!-- Func (handle null) -->
      <template #[`item.func`]="{ value }">
        {{ value ?? '-' }}
      </template>

      <!-- Qual score (handle null) -->
      <template #[`item.qual`]="{ value }">
        {{ value !== null ? value.toFixed(1) : '-' }}
      </template>

      <!-- Transcript (handle null) -->
      <template #[`item.transcript`]="{ value }">
        <span class="variant-data-mono">{{ value ?? '-' }}</span>
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
        <span
          v-if="resolveLink(link.id, item)"
          class="external-link"
          @click="openExternalLink(resolveLink(link.id, item)!, $event)"
        >
          View
          <v-icon size="x-small" class="external-link__icon">mdi-open-in-new</v-icon>
        </span>
        <span v-else class="text-grey">--</span>
      </template>
    </v-data-table-server>

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
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import type {
  Variant,
  VariantFilter,
  PaginationCursor,
  PaginatedResult,
  SortItem
} from '../../../shared/types/api'
import { useExternalLinksStore, type ExternalLinkConfig } from '../stores/externalLinksStore'
import { resolveUrlTemplate, buildOmimUrl, type VariantLinkData } from '../utils/externalLinks'
import { useAnnotations, ACMG_COLORS, ACMG_ABBREV } from '../composables/useAnnotations'
import type { AcmgClassification } from '../../../main/database/types'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import AcmgMenu from './AcmgMenu.vue'
import CommentDialog from './CommentDialog.vue'

interface Props {
  caseId: number
  filters: Omit<VariantFilter, 'case_id'>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:counts': [counts: { filtered: number; total: number }]
  'update:hasSort': [hasSort: boolean]
  'row-click': [variant: Variant]
}>()

// Initialize external links store
const linksStore = useExternalLinksStore()

// Initialize annotations composable
const {
  isStarred,
  isGlobalStarred,
  getAcmgClassification,
  getGlobalAcmgClassification,
  loadAnnotationsBatch,
  toggleStar,
  clearCache,
  setAcmgClassification,
  getGlobalComment,
  getPerCaseComment,
  upsertGlobalComment,
  upsertPerCaseComment,
  getAnnotations
} = useAnnotations()

// Initialize column preferences (only prefs needed here, management is in FilterToolbar)
const { prefs } = useColumnPreferences('variant-table')

// Scroll sync refs
const topScrollbarRef = ref<HTMLElement | null>(null)
const topScrollbarInnerRef = ref<HTMLElement | null>(null)
const dataTableRef = ref<InstanceType<typeof import('vuetify/components').VDataTableServer> | null>(
  null
)
let tableWrapperEl: HTMLElement | null = null
let isSyncingScroll = false

// Middle mouse button drag scrolling state
let isMiddleMouseDragging = false
let middleMouseStartX = 0
let middleMouseScrollLeft = 0

// Table state - DO NOT mutate these in loadVariants handler (infinite loop)
const variants = ref<Variant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const page = ref(1)
const itemsPerPage = ref(50)
const sortBy = ref<SortItem[]>([])

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
  { title: 'cDNA', key: 'cdna', sortable: false },
  { title: 'AA Change', key: 'aa_change', sortable: false },
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

// Handle star toggle (per-case)
const handleStarToggle = async (item: Variant): Promise<void> => {
  await toggleStar(props.caseId, item.id, item.chr, item.pos, item.ref, item.alt)
}

// Check if variant has any comment
const hasAnyComment = (item: Variant): boolean => {
  const globalComment = getGlobalComment(item.chr, item.pos, item.ref, item.alt)
  const perCaseComment = getPerCaseComment(item.chr, item.pos, item.ref, item.alt)
  return (
    (globalComment !== null && globalComment !== '') ||
    (perCaseComment !== null && perCaseComment !== '')
  )
}

// Open comment dialog for variant
const openCommentDialog = (item: Variant) => {
  selectedVariantForComment.value = item
  commentDialogOpen.value = true
}

// Handle ACMG selection (per-case)
const handleAcmgSelect = async (
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
    // Convert reactive proxies to plain objects for IPC serialization
    const plainFilters = JSON.parse(JSON.stringify(props.filters))
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

// Formatting functions
const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

const formatScientific = (value: number | null): string => {
  if (value === null) return '-'
  if (value < 0.001 && value > 0) {
    return new Intl.NumberFormat('en-US', {
      notation: 'scientific',
      maximumFractionDigits: 1
    }).format(value)
  }
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4
  }).format(value)
}

const getClinVarColor = (significance: string | null): string => {
  if ((significance ?? null) === null) return 'grey'
  // After null check, significance is guaranteed to be string
  const sig = significance as string
  const colorMap: Record<string, string> = {
    Pathogenic: 'red',
    Likely_pathogenic: 'red-lighten-1',
    Uncertain_significance: 'amber',
    Likely_benign: 'green-lighten-1',
    Benign: 'green'
  }
  return (colorMap[sig] ?? null) !== null ? colorMap[sig] : 'grey'
}

// Reset sort to default (no sorting)
const resetSort = () => {
  sortBy.value = []
}

// --- Scroll sync and middle mouse button handling ---

// Handle top scrollbar scroll - sync to table
const handleTopScroll = () => {
  if (isSyncingScroll || !tableWrapperEl || !topScrollbarRef.value) return
  isSyncingScroll = true
  tableWrapperEl.scrollLeft = topScrollbarRef.value.scrollLeft
  isSyncingScroll = false
}

// Handle table scroll - sync to top scrollbar
const handleTableScroll = () => {
  if (isSyncingScroll || !tableWrapperEl || !topScrollbarRef.value) return
  isSyncingScroll = true
  topScrollbarRef.value.scrollLeft = tableWrapperEl.scrollLeft
  isSyncingScroll = false
}

// Update top scrollbar width to match table content
const updateTopScrollbarWidth = () => {
  if (!tableWrapperEl || !topScrollbarInnerRef.value) return
  topScrollbarInnerRef.value.style.width = `${tableWrapperEl.scrollWidth}px`
}

// Middle mouse button handlers
const handleMouseDown = (e: MouseEvent) => {
  if (e.button === 1 && tableWrapperEl) {
    // Middle mouse button
    e.preventDefault()
    isMiddleMouseDragging = true
    middleMouseStartX = e.pageX - tableWrapperEl.offsetLeft
    middleMouseScrollLeft = tableWrapperEl.scrollLeft
    tableWrapperEl.style.cursor = 'grabbing'
  }
}

const handleMouseMove = (e: MouseEvent) => {
  if (!isMiddleMouseDragging || !tableWrapperEl) return
  e.preventDefault()
  const x = e.pageX - tableWrapperEl.offsetLeft
  const walk = (x - middleMouseStartX) * 2 // Multiply for faster scroll
  tableWrapperEl.scrollLeft = middleMouseScrollLeft - walk
}

const handleMouseUp = () => {
  if (isMiddleMouseDragging && tableWrapperEl) {
    isMiddleMouseDragging = false
    tableWrapperEl.style.cursor = ''
  }
}

// Prevent default middle-click behavior (auto-scroll)
const handleAuxClick = (e: MouseEvent) => {
  if (e.button === 1) {
    e.preventDefault()
  }
}

// Setup scroll sync and middle mouse drag
onMounted(async () => {
  await nextTick()

  // Find the table wrapper element

  const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
  if (tableEl) {
    tableWrapperEl = tableEl.querySelector('.v-table__wrapper') as HTMLElement | null

    if (tableWrapperEl) {
      // Sync scroll events
      tableWrapperEl.addEventListener('scroll', handleTableScroll)

      // Middle mouse button handlers
      tableWrapperEl.addEventListener('mousedown', handleMouseDown)
      // eslint-disable-next-line no-undef
      document.addEventListener('mousemove', handleMouseMove)
      // eslint-disable-next-line no-undef
      document.addEventListener('mouseup', handleMouseUp)
      tableWrapperEl.addEventListener('auxclick', handleAuxClick)

      // Update top scrollbar width
      updateTopScrollbarWidth()

      // Use ResizeObserver to keep scrollbar width in sync
      const resizeObserver = new ResizeObserver(() => {
        updateTopScrollbarWidth()
      })
      resizeObserver.observe(tableWrapperEl)
    }
  }
})

onBeforeUnmount(() => {
  if (tableWrapperEl) {
    tableWrapperEl.removeEventListener('scroll', handleTableScroll)
    tableWrapperEl.removeEventListener('mousedown', handleMouseDown)
    tableWrapperEl.removeEventListener('auxclick', handleAuxClick)
  }
  // eslint-disable-next-line no-undef
  document.removeEventListener('mousemove', handleMouseMove)
  // eslint-disable-next-line no-undef
  document.removeEventListener('mouseup', handleMouseUp)
})

// Expose resetSort for parent components
defineExpose({
  resetSort,
  columns: computed(() => headers.value.map((h) => ({ key: h.key, title: h.title })))
})
</script>

<style scoped>
/* Table container with top scrollbar */
.table-container {
  position: relative;
}

.top-scrollbar-container {
  overflow-x: auto;
  overflow-y: hidden;
  height: 12px;
  background: rgba(var(--v-theme-on-surface), 0.03);
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
  background: rgba(var(--v-theme-on-surface), 0.05);
}

.top-scrollbar-container::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 5px;
}

.top-scrollbar-container::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.35);
}

.text-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.allele-cell {
  max-width: 120px;
  display: inline-block;
}

.external-link {
  cursor: pointer;
  color: rgb(var(--v-theme-primary));
  transition: background-color 0.2s ease;
  white-space: nowrap;
}

.external-link:hover {
  text-decoration: underline;
}

.external-link--clicked {
  background-color: rgba(var(--v-theme-primary), 0.1);
  border-radius: 2px;
}

.external-link__icon {
  opacity: 0.6;
  margin-left: 2px;
  vertical-align: middle;
}

.cursor-pointer {
  cursor: pointer;
}

.genomic-coordinate {
  font-variant-numeric: tabular-nums;
}

.gene-symbol {
  font-weight: 500;
}

.hgvs-notation {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

.variant-data-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

/* Global annotation indicator - subtle ring/border */
.annotation-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  padding: 2px;
  transition: box-shadow 0.15s ease;
}

.annotation-icon-wrapper.has-global {
  box-shadow: 0 0 0 2px rgba(var(--v-theme-primary), 0.4);
}

/* Clickable table rows */
:deep(.v-data-table tbody tr) {
  cursor: pointer;
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
  background: rgba(var(--v-theme-on-surface), 0.05);
}

:deep(.v-table__wrapper)::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 5px;
}

:deep(.v-table__wrapper)::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.35);
}
</style>
