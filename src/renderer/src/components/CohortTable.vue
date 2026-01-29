<template>
  <div>
    <!-- Search bar -->
    <v-text-field
      v-model="searchTerm"
      prepend-inner-icon="mdi-magnify"
      placeholder="Search by gene, position (chr:pos), or HGVS notation..."
      clearable
      density="compact"
      variant="outlined"
      hide-details
      class="mb-3"
      @update:model-value="handleSearchChange"
    />

    <v-data-table-server
      v-model:items-per-page="itemsPerPage"
      v-model:sort-by="sortBy"
      v-model:expanded="expandedRows"
      :headers="headers"
      :items="cohortVariants"
      :items-length="totalCount ?? 0"
      :loading="loading"
      :items-per-page-options="[25, 50, 100]"
      item-value="variant_key"
      density="compact"
      show-expand
      class="elevation-1"
      @update:options="handleTableOptions"
      @click:row="(_event: unknown, { item }: { item: CohortVariant }) => emit('row-click', item)"
    >
      <!-- Annotations column (global star, ACMG, comment) -->
      <template #[`item.annotations`]="{ item }">
        <div class="d-flex align-center ga-1">
          <!-- Global star toggle -->
          <v-icon
            :icon="
              isGlobalStarred(item.chr, item.pos, item.ref, item.alt)
                ? 'mdi-star'
                : 'mdi-star-outline'
            "
            :color="isGlobalStarred(item.chr, item.pos, item.ref, item.alt) ? 'warning' : undefined"
            size="small"
            class="cursor-pointer"
            @click.stop="handleGlobalStarToggle(item)"
          />
          <!-- Global ACMG classification -->
          <AcmgMenu @select="(c) => handleGlobalAcmgSelect(item, c)">
            <template #activator="{ props: menuProps }">
              <v-chip
                v-if="getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)"
                v-bind="menuProps"
                size="x-small"
                :color="
                  ACMG_COLORS[getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)!]
                "
                label
                class="cursor-pointer"
              >
                {{
                  ACMG_ABBREV[getGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt)!]
                }}
              </v-chip>
              <v-icon
                v-else
                v-bind="menuProps"
                icon="mdi-tag-outline"
                size="small"
                class="cursor-pointer"
              />
            </template>
          </AcmgMenu>
          <!-- Global comment -->
          <v-icon
            :icon="
              getGlobalComment(item.chr, item.pos, item.ref, item.alt)
                ? 'mdi-comment'
                : 'mdi-comment-outline'
            "
            :color="
              getGlobalComment(item.chr, item.pos, item.ref, item.alt) ? 'primary' : undefined
            "
            size="small"
            class="cursor-pointer"
            @click.stop="openCommentDialog(item)"
          />
        </div>
      </template>

      <!-- Chromosome -->
      <template #[`item.chr`]="{ value }">
        <span>{{ value }}</span>
      </template>

      <!-- Position with thousand separators -->
      <template #[`item.pos`]="{ value }">
        <span class="genomic-coordinate">{{ formatPosition(value) }}</span>
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

      <!-- Gene symbol -->
      <template #[`item.gene_symbol`]="{ value }">
        <span class="gene-symbol">{{ value ?? '--' }}</span>
      </template>

      <!-- cDNA HGVS -->
      <template #[`item.cdna`]="{ value }">
        <span class="variant-data-mono">{{ value ?? '--' }}</span>
      </template>

      <!-- Protein change -->
      <template #[`item.aa_change`]="{ value }">
        <span class="variant-data-mono">{{ value ?? '--' }}</span>
      </template>

      <!-- Carrier count as chip with "N / total" format -->
      <template #[`item.carrier_count`]="{ item }">
        <v-chip size="small" color="primary" label>
          {{ item.carrier_count }} / {{ item.total_cases }}
        </v-chip>
      </template>

      <!-- Cohort frequency as percentage -->
      <template #[`item.cohort_frequency`]="{ value }">
        {{ formatPercentage(value) }}
      </template>

      <!-- Het / Hom combined column -->
      <template #[`item.het_count`]="{ item }">
        <span class="text-caption">
          <template v-if="item.hom_count > 0">
            {{ item.het_count }} het / {{ item.hom_count }} hom
          </template>
          <template v-else> {{ item.het_count }} het </template>
        </span>
      </template>

      <!-- Expandable row with carrier details -->
      <template #expanded-row="{ columns, item }">
        <tr>
          <td :colspan="columns.length" class="pa-0">
            <v-table density="compact" class="nested-carriers-table bg-grey-lighten-3">
              <thead>
                <tr>
                  <th class="text-left">Case</th>
                  <th class="text-left">Zygosity</th>
                  <th class="text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="carrier in carrierMap.get(item.variant_key)" :key="carrier.case_id">
                  <td>{{ carrier.case_name }}</td>
                  <td>
                    <v-chip
                      size="x-small"
                      :color="isHomozygous(carrier.gt_num) ? 'error' : 'warning'"
                      label
                    >
                      {{ formatZygosity(carrier.gt_num) }}
                    </v-chip>
                  </td>
                  <td>
                    <v-btn
                      size="small"
                      variant="text"
                      prepend-icon="mdi-open-in-app"
                      @click="handleNavigateToCase(carrier.case_id, item)"
                    >
                      View in Case
                    </v-btn>
                  </td>
                </tr>
              </tbody>
            </v-table>
          </td>
        </tr>
      </template>
    </v-data-table-server>

    <!-- Comment dialog for global comments (cohort mode - global only) -->
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
      :per-case-comment="null"
      :global-timestamps="getGlobalTimestamps(selectedVariantForComment)"
      :per-case-timestamps="null"
      @save="handleCommentSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { CohortVariant, CohortCarrier } from '../../../shared/types/cohort'
import type { AcmgClassification } from '../../../main/database/types'
import { useAnnotations, ACMG_COLORS, ACMG_ABBREV } from '../composables/useAnnotations'
import AcmgMenu from './AcmgMenu.vue'
import CommentDialog from './CommentDialog.vue'

// Emit for navigation and row click
const emit = defineEmits<{
  'navigate-to-case': [
    payload: {
      caseId: number
      chr: string
      pos: number
      ref: string
      alt: string
      geneSymbol: string | null
      cdna: string | null
    }
  ]
  'row-click': [variant: CohortVariant]
}>()

// Initialize annotations composable (global methods for cohort mode)
const {
  isGlobalStarred,
  getGlobalAcmgClassification,
  loadGlobalAnnotationsBatch,
  toggleGlobalStar,
  setGlobalAcmgClassification,
  getGlobalComment,
  upsertGlobalComment,
  getAnnotations
} = useAnnotations()

// Table state
const cohortVariants = ref<CohortVariant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const itemsPerPage = ref(50)
const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([])

// Comment dialog state
const commentDialogOpen = ref(false)
const selectedVariantForComment = ref<CohortVariant | null>(null)

// Search state
const searchTerm = ref('')
// eslint-disable-next-line no-undef
let searchDebounceTimeout: ReturnType<typeof setTimeout> | null = null

// Expand state
const expandedRows = ref<string[]>([])

// Carrier state (lazy-loaded per variant)
const carrierMap = ref<Map<string, CohortCarrier[]>>(new Map())

// Current query parameters
const currentParams = ref({
  search_term: undefined as string | undefined,
  sort_by: undefined as string | undefined,
  sort_order: 'desc' as 'asc' | 'desc',
  limit: 50,
  offset: 0
})

// Table headers
const headers = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' as const },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' as const },
  { title: 'Ref', key: 'ref', sortable: false, width: '100px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '100px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'c.', key: 'cdna', sortable: false },
  { title: 'p.', key: 'aa_change', sortable: false },
  { title: 'Carriers', key: 'carrier_count', sortable: true, align: 'end' as const },
  { title: 'Frequency', key: 'cohort_frequency', sortable: true, align: 'end' as const },
  { title: 'Het / Hom', key: 'het_count', sortable: true }
]

// Handle search change with debounce
const handleSearchChange = (value: string | null): void => {
  // Clear existing timeout
  if (searchDebounceTimeout !== null) {
    // eslint-disable-next-line no-undef
    clearTimeout(searchDebounceTimeout)
  }

  // Set new timeout for 300ms debounce
  // eslint-disable-next-line no-undef
  searchDebounceTimeout = setTimeout(() => {
    currentParams.value.search_term = value == null || value === '' ? undefined : value
    currentParams.value.offset = 0 // Reset to first page on search
    void loadCohortVariants()
  }, 300)
}

// Load cohort variants from backend
const loadCohortVariants = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
    return
  }

  loading.value = true
  try {
    // Build a plain object with no undefined values (IPC structured clone rejects undefined)
    const ipcParams: Record<string, string | number> = {
      limit: currentParams.value.limit,
      offset: currentParams.value.offset,
      sort_order: currentParams.value.sort_order
    }
    if (currentParams.value.search_term !== undefined) {
      ipcParams.search_term = currentParams.value.search_term
    }
    if (currentParams.value.sort_by !== undefined) {
      ipcParams.sort_by = currentParams.value.sort_by
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.cohort.getVariants(ipcParams)
    cohortVariants.value = result.data ?? []
    totalCount.value = result.total_count ?? 0
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load cohort variants:', error)
    cohortVariants.value = []
    totalCount.value = 0
  } finally {
    loading.value = false
  }
}

// Handle table options update (pagination, sorting)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleTableOptions = async (options: any): Promise<void> => {
  const { page, itemsPerPage: perPage, sortBy: newSortBy } = options

  // Update pagination
  currentParams.value.limit = perPage
  currentParams.value.offset = (page - 1) * perPage

  // Update sorting
  if (newSortBy !== undefined && newSortBy.length > 0) {
    currentParams.value.sort_by = newSortBy[0].key
    currentParams.value.sort_order = newSortBy[0].order
  } else {
    // Default sort when no user sort
    currentParams.value.sort_by = undefined
    currentParams.value.sort_order = 'desc'
  }

  await loadCohortVariants()
}

// Watch cohortVariants and load global annotations for visible rows
watch(cohortVariants, async (variants) => {
  if (variants.length > 0) {
    await loadGlobalAnnotationsBatch(
      variants.map((v) => ({ chr: v.chr, pos: v.pos, ref: v.ref, alt: v.alt }))
    )
  }
})

// Watch expanded rows and lazy-load carriers for newly expanded ones
watch(expandedRows, async (keys) => {
  for (const key of keys) {
    if (!carrierMap.value.has(key)) {
      // Find the variant by key and load carriers
      const variant = cohortVariants.value.find((v) => v.variant_key === key)
      if (variant !== undefined) {
        await loadCarriers(variant)
      }
    }
  }
})

// Load carriers for a specific variant
const loadCarriers = async (variant: CohortVariant): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const carriers = await (window as any).api.cohort.getCarriers(
      variant.chr,
      variant.pos,
      variant.ref,
      variant.alt
    )
    carrierMap.value.set(variant.variant_key, carriers)
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load carriers:', error)
    carrierMap.value.set(variant.variant_key, [])
  }
}

// Zygosity helper functions
const isHomozygous = (gt: string): boolean => {
  return gt.includes('1/1') || gt.includes('1|1')
}

const formatZygosity = (gt: string): string => {
  return isHomozygous(gt) ? 'hom' : 'het'
}

// Handle navigation to case
const handleNavigateToCase = (caseId: number, variant: CohortVariant): void => {
  emit('navigate-to-case', {
    caseId,
    chr: variant.chr,
    pos: variant.pos,
    ref: variant.ref,
    alt: variant.alt,
    geneSymbol: variant.gene_symbol,
    cdna: variant.cdna
  })
}

// Formatting functions
const formatPosition = (pos: number): string => {
  return new Intl.NumberFormat('en-US').format(pos)
}

const formatPercentage = (value: number): string => {
  return `${(value * 100).toFixed(1)}%`
}

// Global annotation handlers
const handleGlobalStarToggle = async (item: CohortVariant): Promise<void> => {
  await toggleGlobalStar(item.chr, item.pos, item.ref, item.alt)
}

const handleGlobalAcmgSelect = async (
  item: CohortVariant,
  classification: AcmgClassification | null
): Promise<void> => {
  await setGlobalAcmgClassification(item.chr, item.pos, item.ref, item.alt, classification)
}

const openCommentDialog = (item: CohortVariant): void => {
  selectedVariantForComment.value = item
  commentDialogOpen.value = true
}

// Get global timestamps for comment dialog
const getGlobalTimestamps = (
  item: CohortVariant | null
): { created_at: number; updated_at: number } | null => {
  if (!item) return null
  const annotations = getAnnotations(item.chr, item.pos, item.ref, item.alt)
  if (!annotations?.global) return null
  return { created_at: annotations.global.created_at, updated_at: annotations.global.updated_at }
}

// Handle comment save (cohort mode - global only)
const handleCommentSave = async (data: {
  globalComment: string | null
  perCaseComment: string | null
  globalChanged: boolean
  perCaseChanged: boolean
}): Promise<void> => {
  if (selectedVariantForComment.value === null) return
  const item = selectedVariantForComment.value

  // In cohort mode, only save global comments
  if (data.globalChanged) {
    await upsertGlobalComment(item.chr, item.pos, item.ref, item.alt, data.globalComment)
  }

  commentDialogOpen.value = false
}

// Refresh function (called by parent when switching tabs or after imports)
const refresh = async (): Promise<void> => {
  await loadCohortVariants()
}

// Load data on mount
onMounted(async () => {
  await loadCohortVariants()
})

// Expose refresh method to parent
defineExpose({ refresh })
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

.genomic-coordinate {
  font-variant-numeric: tabular-nums;
}

.gene-symbol {
  font-weight: 500;
}

.variant-data-mono {
  font-family: 'Courier New', monospace;
  font-size: 0.85em;
}

/* Clickable table rows */
:deep(.v-data-table tbody tr) {
  cursor: pointer;
}
</style>
