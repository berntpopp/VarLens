<template>
  <div>
    <v-data-table-server
      v-model:page="page"
      v-model:items-per-page="itemsPerPage"
      v-model:sort-by="sortBy"
      :headers="headers"
      :items="variants"
      :items-length="totalCount"
      :loading="loading"
      :items-per-page-options="[25, 50, 100]"
      density="compact"
      multi-sort
      class="elevation-1"
      @update:options="loadVariants"
    >
      <!-- Star toggle column -->
      <template #[`item.starred`]="{ item }">
        <v-icon
          :icon="
            isStarred(item.chr, item.pos, item.ref, item.alt) ? 'mdi-star' : 'mdi-star-outline'
          "
          :color="isStarred(item.chr, item.pos, item.ref, item.alt) ? 'amber' : 'grey-lighten-1'"
          size="default"
          class="cursor-pointer"
          @click.stop="handleStarToggle(item)"
        />
      </template>

      <!-- ACMG classification column -->
      <template #[`item.acmg`]="{ item }">
        <AcmgMenu @select="(c) => handleAcmgSelect(item, c)">
          <template #activator="{ props: menuProps }">
            <v-chip
              v-if="getAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
              v-bind="menuProps"
              :color="ACMG_COLORS[getAcmgClassification(item.chr, item.pos, item.ref, item.alt)!]"
              size="x-small"
              label
              class="cursor-pointer"
            >
              {{ ACMG_ABBREV[getAcmgClassification(item.chr, item.pos, item.ref, item.alt)!] }}
            </v-chip>
            <v-btn
              v-else
              v-bind="menuProps"
              icon="mdi-tag-plus-outline"
              size="x-small"
              variant="text"
              color="grey-lighten-1"
            />
          </template>
        </AcmgMenu>
      </template>

      <!-- Comment column -->
      <template #[`item.comment`]="{ item }">
        <v-icon
          :icon="hasAnyComment(item) ? 'mdi-comment-text' : 'mdi-comment-text-outline'"
          :color="hasAnyComment(item) ? 'primary' : 'grey-lighten-1'"
          size="default"
          class="cursor-pointer"
          @click.stop="openCommentDialog(item)"
        />
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

      <!-- HPO Match (handle null, truncate long text) -->
      <template #[`item.hpo_match`]="{ value }">
        <v-tooltip v-if="value && value.length > 30" location="top">
          <template #activator="{ props: tooltipProps }">
            <span
              v-bind="tooltipProps"
              class="text-truncate"
              style="max-width: 150px; display: inline-block"
            >
              {{ value.substring(0, 30) }}...
            </span>
          </template>
          <span>{{ value }}</span>
        </v-tooltip>
        <span v-else>{{ value ?? '-' }}</span>
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
import { ref, watch, computed } from 'vue'
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
}>()

// Initialize external links store
const linksStore = useExternalLinksStore()

// Initialize annotations composable
const {
  isStarred,
  getAcmgClassification,
  loadAnnotationsBatch,
  toggleGlobalStar,
  clearCache,
  setAcmgClassification,
  getGlobalComment,
  getPerCaseComment,
  upsertGlobalComment,
  upsertPerCaseComment,
  getAnnotations
} = useAnnotations()

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

// Dynamic headers with virtual link columns from store
const headers = computed(() => {
  const baseHeaders = [
    { title: '', key: 'starred', sortable: false, width: '48px', align: 'center' as const },
    { title: 'ACMG', key: 'acmg', sortable: false, width: '64px', align: 'center' as const },
    { title: '', key: 'comment', sortable: false, width: '48px', align: 'center' as const },
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
    { title: 'HPO Match', key: 'hpo_match', sortable: false },
    { title: 'MoI', key: 'moi', sortable: true }
  ]

  // Add virtual column headers from store
  for (const link of linksStore.virtualLinks) {
    baseHeaders.push({ title: link.name, key: `_link_${link.id}`, sortable: false, width: '80px' })
  }

  return baseHeaders
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

// Handle star toggle
const handleStarToggle = async (item: Variant): Promise<void> => {
  await toggleGlobalStar(item.chr, item.pos, item.ref, item.alt)
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

// Handle ACMG selection
const handleAcmgSelect = async (
  item: Variant,
  classification: AcmgClassification | null
): Promise<void> => {
  await setAcmgClassification(item.chr, item.pos, item.ref, item.alt, classification)
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

// Expose resetSort for parent components
defineExpose({ resetSort })
</script>

<style scoped>
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
</style>
