<template>
  <div>
    <!-- Filter toolbar matching Case Analysis styling -->
    <div class="filter-toolbar-container">
      <v-toolbar density="default" flat class="filter-toolbar px-3 py-2">
        <!-- Filter groups wrapper -->
        <div class="filter-groups-scroll">
          <div class="filter-groups-container">
            <!-- Search filter -->
            <div class="filter-section search-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-magnify</v-icon>
                <span>Search</span>
              </div>
              <v-text-field
                v-model="searchTerm"
                prepend-inner-icon="mdi-magnify"
                placeholder="Gene, position, HGVS..."
                clearable
                density="compact"
                variant="outlined"
                hide-details
                class="filter-input"
                :class="{ 'filter-active': searchTerm !== '' }"
                @update:model-value="handleSearchChange"
              />
            </div>

            <!-- Gene filter -->
            <div class="filter-section gene-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-dna</v-icon>
                <span>Gene</span>
              </div>
              <v-text-field
                v-model="filters.geneSymbol"
                prepend-inner-icon="mdi-magnify"
                placeholder="Gene symbol..."
                clearable
                density="compact"
                variant="outlined"
                hide-details
                class="filter-input"
                :class="{ 'filter-active': filters.geneSymbol !== '' }"
                @update:model-value="debouncedApplyFilters"
              />
            </div>

            <!-- Impact filter -->
            <div class="filter-section impact-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-flash</v-icon>
                <span>Impact</span>
              </div>
              <v-chip-group v-model="selectedImpactPresets" multiple>
                <v-chip
                  v-for="preset in impactPresets"
                  :key="preset.value"
                  :value="preset.value"
                  :color="preset.color"
                  filter
                  variant="outlined"
                  size="small"
                >
                  {{ preset.label }}
                </v-chip>
              </v-chip-group>
            </div>

            <!-- Function/Consequence filter (GroupedMultiSelect matching FilterToolbar) -->
            <div class="filter-section func-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-function</v-icon>
                <span>Consequence</span>
                <v-tooltip location="top" max-width="280">
                  <template #activator="{ props: tooltipProps }">
                    <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                      mdi-information-outline
                    </v-icon>
                  </template>
                  <span>
                    Filter by variant consequence: truncating (stop gained, frameshift), missense,
                    splice, non-coding, etc. Select groups or individual types.
                  </span>
                </v-tooltip>
              </div>
              <GroupedMultiSelect
                v-model="filters.funcs"
                :config="consequenceGroups"
                label="Consequence"
                placeholder="Select..."
                icon="mdi-function"
              />
            </div>

            <!-- ClinVar filter (GroupedMultiSelect matching FilterToolbar) -->
            <div class="filter-section clinvar-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-hospital-box</v-icon>
                <span>ClinVar</span>
                <v-tooltip location="top" max-width="280">
                  <template #activator="{ props: tooltipProps }">
                    <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                      mdi-information-outline
                    </v-icon>
                  </template>
                  <span>
                    Filter by ClinVar pathogenicity: select groups (Pathogenic, VUS, Benign) or
                    individual classifications.
                  </span>
                </v-tooltip>
              </div>
              <GroupedMultiSelect
                v-model="filters.clinvars"
                :config="clinvarGroups"
                label="ClinVar"
                placeholder="Select..."
                icon="mdi-hospital-box"
              />
            </div>

            <!-- Cohort Frequency filter (unique to cohort) -->
            <div class="filter-section cohort-freq-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-account-group</v-icon>
                <span>Cohort Freq</span>
                <v-tooltip location="top" max-width="280">
                  <template #activator="{ props: tooltipProps }">
                    <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                      mdi-information-outline
                    </v-icon>
                  </template>
                  <span>
                    Minimum frequency within the cohort. Higher values = more common variants.
                  </span>
                </v-tooltip>
              </div>
              <div class="preset-with-custom">
                <v-chip-group v-model="selectedCohortFreqPreset">
                  <v-chip
                    v-for="preset in cohortFreqPresets"
                    :key="preset.value"
                    :value="preset.value"
                    filter
                    variant="outlined"
                    size="small"
                    color="purple"
                  >
                    {{ preset.label }}
                  </v-chip>
                </v-chip-group>
                <v-text-field
                  v-model.number="customCohortFreq"
                  type="number"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                  placeholder="Custom %"
                  class="filter-input custom-input"
                  :class="{ 'filter-active': customCohortFreq != null }"
                  step="1"
                  min="0"
                  max="100"
                  @update:model-value="handleCustomCohortFreqChange"
                />
              </div>
            </div>

            <!-- gnomAD Frequency filter -->
            <div class="filter-section frequency-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-earth</v-icon>
                <span>gnomAD AF</span>
                <v-tooltip location="top" max-width="280">
                  <template #activator="{ props: tooltipProps }">
                    <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                      mdi-information-outline
                    </v-icon>
                  </template>
                  <span> Maximum allele frequency in gnomAD. Lower values = rarer variants. </span>
                </v-tooltip>
              </div>
              <div class="preset-with-custom">
                <v-chip-group v-model="selectedAfPreset">
                  <v-chip
                    v-for="preset in afPresets"
                    :key="preset.value"
                    :value="preset.value"
                    filter
                    variant="outlined"
                    size="small"
                    color="teal"
                  >
                    {{ preset.label }}
                  </v-chip>
                </v-chip-group>
                <v-text-field
                  v-model.number="customGnomadAf"
                  type="number"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                  placeholder="Custom %"
                  class="filter-input custom-input"
                  :class="{ 'filter-active': customGnomadAf != null }"
                  step="0.001"
                  min="0"
                  max="100"
                  @update:model-value="handleCustomGnomadAfChange"
                />
              </div>
            </div>

            <!-- CADD filter -->
            <div class="filter-section cadd-section">
              <div class="section-label">
                <v-icon size="small" class="mr-1">mdi-alert-circle</v-icon>
                <span>CADD</span>
                <v-tooltip location="top" max-width="280">
                  <template #activator="{ props: tooltipProps }">
                    <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon">
                      mdi-information-outline
                    </v-icon>
                  </template>
                  <span>
                    Minimum CADD phred score. Higher scores = more likely deleterious. Typical
                    thresholds: 15 (top 3%), 20 (top 1%), 25 (top 0.3%).
                  </span>
                </v-tooltip>
              </div>
              <div class="preset-with-custom">
                <v-chip-group v-model="selectedCaddPreset">
                  <v-chip
                    v-for="preset in caddPresets"
                    :key="preset.value"
                    :value="preset.value"
                    filter
                    variant="outlined"
                    size="small"
                    color="deep-purple"
                  >
                    {{ preset.label }}
                  </v-chip>
                </v-chip-group>
                <v-text-field
                  v-model.number="customCadd"
                  type="number"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                  placeholder="Custom"
                  class="filter-input custom-input"
                  :class="{ 'filter-active': customCadd != null }"
                  step="1"
                  min="0"
                  max="60"
                  @update:model-value="handleCustomCaddChange"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Results & Actions (matching FilterToolbar layout) -->
        <div class="results-section ml-auto">
          <v-chip
            :color="hasActiveFilters ? 'primary' : 'default'"
            :variant="hasActiveFilters ? 'flat' : 'tonal'"
            size="small"
            class="results-chip"
          >
            <v-icon start size="small">mdi-filter-variant</v-icon>
            <strong>{{ totalCount?.toLocaleString() ?? '0' }}</strong>
            <template v-if="cohortSummary && hasActiveFilters">
              <span class="mx-1 text-medium-emphasis">/</span>
              <span class="text-medium-emphasis">{{
                cohortSummary.unique_variants?.toLocaleString() ?? '0'
              }}</span>
            </template>
          </v-chip>

          <v-btn
            :disabled="!hasActiveFilters"
            :color="hasActiveFilters ? 'error' : undefined"
            :variant="hasActiveFilters ? 'tonal' : 'text'"
            size="small"
            prepend-icon="mdi-filter-off"
            @click="clearAllFilters"
          >
            Clear
          </v-btn>

          <!-- Placeholder for filter visibility menu -->
          <div class="placeholder-cell"></div>

          <ColumnVisibilityMenu
            :columns="orderedColumns.map((h) => ({ key: h.key, title: h.title }))"
            :visible-columns="visibleHeaders.map((h) => h.key)"
            table-id="cohort-table"
            @toggle:column="toggleColumnVisibility"
            @reorder="setColumnOrder"
            @reset="resetToDefaults"
          />

          <!-- Export button -->
          <v-tooltip location="top">
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                :disabled="totalCount === 0 || exporting"
                :loading="exporting"
                color="success"
                variant="tonal"
                size="small"
                prepend-icon="mdi-microsoft-excel"
                @click="exportToExcel"
              >
                Export
              </v-btn>
            </template>
            <span>Export cohort variants to Excel</span>
          </v-tooltip>

          <!-- Empty cell to complete grid -->
          <div class="placeholder-cell"></div>
        </div>
      </v-toolbar>

      <!-- Applied Filters Summary Bar (matching FilterToolbar) -->
      <div v-if="activeFiltersList.length > 0" class="applied-filters-bar">
        <span class="text-caption text-medium-emphasis mr-2">Active:</span>
        <v-chip
          v-for="filter in activeFiltersList"
          :key="filter.id"
          size="small"
          closable
          variant="tonal"
          color="primary"
          class="mr-1"
          @click:close="clearFilter(filter.id)"
        >
          <span class="font-weight-medium">{{ filter.label }}:</span>
          <span class="ml-1">{{ filter.value }}</span>
        </v-chip>
        <v-btn variant="text" size="x-small" color="error" class="ml-1" @click="clearAllFilters">
          Clear all
        </v-btn>
      </div>
    </div>

    <!-- Top scrollbar (synced with table) -->
    <div ref="topScrollbarRef" class="top-scrollbar-container" @scroll="handleTopScroll">
      <div ref="topScrollbarInnerRef" class="top-scrollbar-inner"></div>
    </div>

    <v-data-table-server
      ref="dataTableRef"
      v-model:items-per-page="itemsPerPage"
      v-model:sort-by="sortBy"
      v-model:expanded="expandedRows"
      :headers="visibleHeaders"
      :items="cohortVariants"
      :items-length="totalCount ?? 0"
      :loading="loading"
      :items-per-page-options="[25, 50, 100]"
      item-value="variant_key"
      density="compact"
      show-expand
      class="elevation-1"
      :row-props="getRowProps"
      @update:options="handleTableOptions"
      @click:row="handleRowClick"
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

      <!-- Impact/Consequence with color coding -->
      <template #[`item.consequence`]="{ value }">
        <v-chip v-if="value" :color="getImpactColor(value)" size="x-small" label>
          {{ value }}
        </v-chip>
        <span v-else class="text-medium-emphasis">--</span>
      </template>

      <!-- Functional consequence -->
      <template #[`item.func`]="{ value }">
        <span>{{ value ?? '--' }}</span>
      </template>

      <!-- ClinVar with color coding -->
      <template #[`item.clinvar`]="{ value }">
        <v-chip v-if="value" :color="getClinvarColor(value)" size="x-small" label>
          {{ value }}
        </v-chip>
        <span v-else class="text-medium-emphasis">--</span>
      </template>

      <!-- gnomAD allele frequency -->
      <template #[`item.gnomad_af`]="{ value }">
        <span v-if="value !== null && value !== undefined" class="genomic-coordinate">
          {{ formatScientific(value) }}
        </span>
        <span v-else class="text-medium-emphasis">--</span>
      </template>

      <!-- CADD phred score -->
      <template #[`item.cadd_phred`]="{ value }">
        <v-chip
          v-if="value !== null && value !== undefined"
          :color="getCaddColor(value)"
          size="x-small"
          label
        >
          {{ value.toFixed(1) }}
        </v-chip>
        <span v-else class="text-medium-emphasis">--</span>
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

    <!-- Snackbar for user feedback -->
    <v-snackbar
      v-model="snackbar.visible"
      :color="snackbar.color"
      :timeout="4000"
      location="bottom right"
    >
      {{ snackbar.message }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useDebounce } from '../composables/useDebounce'
import type { CohortVariant, CohortCarrier } from '../../../shared/types/cohort'
import type { AcmgClassification } from '../../../main/database/types'
import { useAnnotations, ACMG_COLORS, ACMG_ABBREV } from '../composables/useAnnotations'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import { consequenceGroups, clinvarGroups } from '../config/filterGroups'
import AcmgMenu from './AcmgMenu.vue'
import CommentDialog from './CommentDialog.vue'
import ColumnVisibilityMenu from './ColumnVisibilityMenu.vue'
import GroupedMultiSelect from './GroupedMultiSelect.vue'

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

// Initialize column preferences
const { prefs, resetToDefaults, toggleColumnVisibility, setColumnOrder } =
  useColumnPreferences('cohort-table')

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

// Table state
const cohortVariants = ref<CohortVariant[]>([])
const totalCount = ref(0)
const loading = ref(false)
const exporting = ref(false)
const itemsPerPage = ref(50)
const sortBy = ref<{ key: string; order: 'asc' | 'desc' }[]>([])

// Comment dialog state
const commentDialogOpen = ref(false)
const selectedVariantForComment = ref<CohortVariant | null>(null)

// Search state
const searchTerm = ref('')
// eslint-disable-next-line no-undef
let searchDebounceTimeout: ReturnType<typeof setTimeout> | null = null

// Selected row tracking for highlighting
const selectedVariantKey = ref<string | null>(null)

// Expand state
const expandedRows = ref<string[]>([])

// Carrier state (lazy-loaded per variant)
const carrierMap = ref<Map<string, CohortCarrier[]>>(new Map())

// Current query parameters - extended with filter parameters
const currentParams = ref({
  search_term: undefined as string | undefined,
  sort_by: undefined as string | undefined,
  sort_order: 'desc' as 'asc' | 'desc',
  limit: 50,
  offset: 0,
  // Filter parameters
  gene_symbol: undefined as string | undefined,
  consequences: undefined as string[] | undefined,
  funcs: undefined as string[] | undefined,
  clinvars: undefined as string[] | undefined,
  gnomad_af_max: undefined as number | undefined,
  cadd_min: undefined as number | undefined,
  cohort_frequency_min: undefined as number | undefined,
  carrier_count_min: undefined as number | undefined
})

// Filter state for UI binding
const filters = ref({
  geneSymbol: '',
  consequences: [] as string[],
  funcs: [] as string[],
  clinvars: [] as string[],
  maxGnomadAf: null as number | null,
  minCadd: null as number | null,
  minCohortFrequency: null as number | null,
  minCarriers: null as number | null
})

// Note: Function and ClinVar options now use GroupedMultiSelect with filterGroups.ts config
// This follows DRY principle - single source of truth for filter options

// Impact presets matching Case Analysis
const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
]

// Cohort frequency presets
const cohortFreqPresets = [
  { label: '≥50%', value: 0.5 },
  { label: '≥25%', value: 0.25 },
  { label: '≥10%', value: 0.1 }
]

// gnomAD AF presets matching Case Analysis
const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
]

// CADD presets matching Case Analysis
const caddPresets = [
  { label: '15', value: 15 },
  { label: '20', value: 20 },
  { label: '25', value: 25 }
]

// Selected presets for UI sync
const selectedImpactPresets = ref<string[]>([])
const selectedCohortFreqPreset = ref<number | null>(null)
const selectedAfPreset = ref<number | null>(null)
const selectedCaddPreset = ref<number | null>(null)

// Custom numeric input state (in user-friendly units: percentages for freq/AF)
const customCohortFreq = ref<number | null>(null) // Percentage (0-100)
const customGnomadAf = ref<number | null>(null) // Percentage (0-100)
const customCadd = ref<number | null>(null) // Raw CADD score

// Cohort summary for total count display
const cohortSummary = ref<{ total_cases: number; unique_variants: number } | null>(null)

// Snackbar state for user feedback
const snackbar = ref({ visible: false, message: '', color: 'success' })

// Computed: has active filters (includes presets)
const hasActiveFilters = computed(() => {
  const afActive =
    filters.value.maxGnomadAf !== null &&
    Number.isNaN(filters.value.maxGnomadAf) === false &&
    filters.value.maxGnomadAf > 0
  const caddActive =
    filters.value.minCadd !== null &&
    Number.isNaN(filters.value.minCadd) === false &&
    filters.value.minCadd >= 0
  const cohortFreqActive =
    filters.value.minCohortFrequency !== null &&
    Number.isNaN(filters.value.minCohortFrequency) === false &&
    filters.value.minCohortFrequency > 0

  return (
    searchTerm.value !== '' ||
    filters.value.geneSymbol !== '' ||
    filters.value.consequences.length > 0 ||
    filters.value.funcs.length > 0 ||
    filters.value.clinvars.length > 0 ||
    afActive ||
    caddActive ||
    cohortFreqActive ||
    (filters.value.minCarriers !== null && filters.value.minCarriers > 0) ||
    // Preset selections
    selectedImpactPresets.value.length > 0 ||
    selectedCohortFreqPreset.value !== null ||
    selectedAfPreset.value !== null ||
    selectedCaddPreset.value !== null
  )
})

// Active filters as chip data for summary bar (matching FilterToolbar)
interface ActiveFilter {
  id: string
  label: string
  value: string
}

const activeFiltersList = computed<ActiveFilter[]>(() => {
  const list: ActiveFilter[] = []

  if (searchTerm.value !== '') {
    list.push({ id: 'search', label: 'Search', value: searchTerm.value })
  }
  if (filters.value.geneSymbol !== '') {
    list.push({ id: 'gene', label: 'Gene', value: filters.value.geneSymbol })
  }
  if (selectedImpactPresets.value.length > 0) {
    list.push({ id: 'impact', label: 'Impact', value: selectedImpactPresets.value.join(', ') })
  }
  if (filters.value.funcs.length > 0) {
    list.push({ id: 'funcs', label: 'Function', value: `${filters.value.funcs.length} selected` })
  }
  if (filters.value.clinvars.length > 0) {
    list.push({
      id: 'clinvars',
      label: 'ClinVar',
      value: `${filters.value.clinvars.length} selected`
    })
  }
  if (
    selectedAfPreset.value !== null ||
    (filters.value.maxGnomadAf !== null && filters.value.maxGnomadAf > 0)
  ) {
    const pct = ((filters.value.maxGnomadAf ?? 0) * 100).toFixed(2)
    list.push({ id: 'frequency', label: 'AF ≤', value: `${pct}%` })
  }
  if (
    selectedCaddPreset.value !== null ||
    (filters.value.minCadd !== null && filters.value.minCadd >= 0)
  ) {
    list.push({ id: 'cadd', label: 'CADD ≥', value: String(filters.value.minCadd ?? 0) })
  }
  if (
    selectedCohortFreqPreset.value !== null ||
    (filters.value.minCohortFrequency !== null && filters.value.minCohortFrequency > 0)
  ) {
    const pct = ((filters.value.minCohortFrequency ?? 0) * 100).toFixed(1)
    list.push({ id: 'cohortFreq', label: 'Cohort ≥', value: `${pct}%` })
  }

  return list
})

// Clear a specific filter by ID
const clearFilter = (filterId: string): void => {
  switch (filterId) {
    case 'search':
      searchTerm.value = ''
      currentParams.value.search_term = undefined
      break
    case 'gene':
      filters.value.geneSymbol = ''
      break
    case 'impact':
      selectedImpactPresets.value = []
      break
    case 'funcs':
      filters.value.funcs = []
      break
    case 'clinvars':
      filters.value.clinvars = []
      break
    case 'frequency':
      filters.value.maxGnomadAf = null
      selectedAfPreset.value = null
      break
    case 'cadd':
      filters.value.minCadd = null
      selectedCaddPreset.value = null
      break
    case 'cohortFreq':
      filters.value.minCohortFrequency = null
      selectedCohortFreqPreset.value = null
      break
  }
  void loadCohortVariants()
}

// Base headers definition - matching Case Analysis columns where applicable
const baseHeaders = [
  { title: '', key: 'annotations', sortable: false, width: '100px', align: 'center' as const },
  { title: 'Chr', key: 'chr', sortable: true },
  { title: 'Position', key: 'pos', sortable: true, align: 'end' as const },
  { title: 'Ref', key: 'ref', sortable: false, width: '80px' },
  { title: 'Alt', key: 'alt', sortable: false, width: '80px' },
  { title: 'Gene', key: 'gene_symbol', sortable: true },
  { title: 'c.', key: 'cdna', sortable: false },
  { title: 'p.', key: 'aa_change', sortable: false },
  { title: 'Impact', key: 'consequence', sortable: true },
  { title: 'Func', key: 'func', sortable: true },
  { title: 'ClinVar', key: 'clinvar', sortable: true },
  { title: 'gnomAD AF', key: 'gnomad_af', sortable: true, align: 'end' as const },
  { title: 'CADD', key: 'cadd_phred', sortable: true, align: 'end' as const },
  { title: 'Carriers', key: 'carrier_count', sortable: true, align: 'end' as const },
  { title: 'Cohort Freq', key: 'cohort_frequency', sortable: true, align: 'end' as const },
  { title: 'Het / Hom', key: 'het_count', sortable: true }
]

// Ordered columns based on user preferences
const orderedColumns = computed(() => {
  if (prefs.value.order.length > 0) {
    return [...baseHeaders].sort((a, b) => {
      const aIdx = prefs.value.order.indexOf(a.key)
      const bIdx = prefs.value.order.indexOf(b.key)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }
  return baseHeaders
})

// Visible headers based on user preferences
const visibleHeaders = computed(() => {
  return orderedColumns.value.filter((h) => prefs.value.visibility[h.key] !== false)
})

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

// Load cohort summary for total count display
const loadCohortSummary = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const summary = await (window as any).api.cohort.getSummary()
    cohortSummary.value = summary
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load cohort summary:', error)
  }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcParams: Record<string, any> = {
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
    // Filter parameters - spread arrays to convert Vue Proxy to plain arrays for IPC
    if (currentParams.value.gene_symbol !== undefined) {
      ipcParams.gene_symbol = currentParams.value.gene_symbol
    }
    if (
      currentParams.value.consequences !== undefined &&
      currentParams.value.consequences.length > 0
    ) {
      ipcParams.consequences = [...currentParams.value.consequences]
    }
    if (currentParams.value.funcs !== undefined && currentParams.value.funcs.length > 0) {
      ipcParams.funcs = [...currentParams.value.funcs]
    }
    if (currentParams.value.clinvars !== undefined && currentParams.value.clinvars.length > 0) {
      ipcParams.clinvars = [...currentParams.value.clinvars]
    }
    if (currentParams.value.gnomad_af_max !== undefined) {
      ipcParams.gnomad_af_max = currentParams.value.gnomad_af_max
    }
    if (currentParams.value.cadd_min !== undefined) {
      ipcParams.cadd_min = currentParams.value.cadd_min
    }
    if (currentParams.value.cohort_frequency_min !== undefined) {
      ipcParams.cohort_frequency_min = currentParams.value.cohort_frequency_min
    }
    if (currentParams.value.carrier_count_min !== undefined) {
      ipcParams.carrier_count_min = currentParams.value.carrier_count_min
    }
    // Deep clone to strip all Vue Proxy objects before IPC (structured clone requires plain objects)
    const plainParams = globalThis.structuredClone(ipcParams)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.cohort.getVariants(plainParams)
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

// Apply filters with debounce
const applyFilters = (): void => {
  // Sync filter state to currentParams
  currentParams.value.gene_symbol =
    filters.value.geneSymbol !== '' ? filters.value.geneSymbol : undefined
  currentParams.value.consequences =
    selectedImpactPresets.value.length > 0 ? selectedImpactPresets.value : undefined
  currentParams.value.funcs = filters.value.funcs.length > 0 ? filters.value.funcs : undefined
  currentParams.value.clinvars =
    filters.value.clinvars.length > 0 ? filters.value.clinvars : undefined
  currentParams.value.gnomad_af_max =
    filters.value.maxGnomadAf !== null && filters.value.maxGnomadAf > 0
      ? filters.value.maxGnomadAf
      : undefined
  currentParams.value.cadd_min =
    filters.value.minCadd !== null && filters.value.minCadd >= 0 ? filters.value.minCadd : undefined
  currentParams.value.cohort_frequency_min =
    filters.value.minCohortFrequency !== null && filters.value.minCohortFrequency > 0
      ? filters.value.minCohortFrequency
      : undefined
  currentParams.value.carrier_count_min =
    filters.value.minCarriers !== null && filters.value.minCarriers > 0
      ? filters.value.minCarriers
      : undefined
  currentParams.value.offset = 0 // Reset pagination
  void loadCohortVariants()
}

// Clear all filters
const clearAllFilters = (): void => {
  searchTerm.value = ''
  filters.value.geneSymbol = ''
  filters.value.consequences = []
  filters.value.funcs = []
  filters.value.clinvars = []
  filters.value.maxGnomadAf = null
  filters.value.minCadd = null
  filters.value.minCohortFrequency = null
  filters.value.minCarriers = null
  selectedImpactPresets.value = []
  selectedCohortFreqPreset.value = null
  selectedAfPreset.value = null
  selectedCaddPreset.value = null
  currentParams.value.search_term = undefined
  currentParams.value.gene_symbol = undefined
  currentParams.value.consequences = undefined
  currentParams.value.funcs = undefined
  currentParams.value.clinvars = undefined
  currentParams.value.gnomad_af_max = undefined
  currentParams.value.cadd_min = undefined
  currentParams.value.cohort_frequency_min = undefined
  currentParams.value.carrier_count_min = undefined
  currentParams.value.offset = 0
  void loadCohortVariants()
}

// Export to Excel
const exportToExcel = async (): Promise<void> => {
  // Guard for browser dev mode (no preload)
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
    return
  }

  exporting.value = true
  try {
    // Build export params with current filters
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exportParams: Record<string, any> = {}

    if (currentParams.value.search_term !== undefined) {
      exportParams.search_term = currentParams.value.search_term
    }
    if (currentParams.value.gene_symbol !== undefined) {
      exportParams.gene_symbol = currentParams.value.gene_symbol
    }
    if (currentParams.value.consequences !== undefined) {
      exportParams.consequences = [...currentParams.value.consequences]
    }
    if (currentParams.value.funcs !== undefined) {
      exportParams.funcs = [...currentParams.value.funcs]
    }
    if (currentParams.value.clinvars !== undefined) {
      exportParams.clinvars = [...currentParams.value.clinvars]
    }
    if (currentParams.value.gnomad_af_max !== undefined) {
      exportParams.gnomad_af_max = currentParams.value.gnomad_af_max
    }
    if (currentParams.value.cadd_min !== undefined) {
      exportParams.cadd_min = currentParams.value.cadd_min
    }
    if (currentParams.value.cohort_frequency_min !== undefined) {
      exportParams.cohort_frequency_min = currentParams.value.cohort_frequency_min
    }
    if (currentParams.value.carrier_count_min !== undefined) {
      exportParams.carrier_count_min = currentParams.value.carrier_count_min
    }

    // Deep clone to strip all Vue Proxy objects before IPC
    const plainExportParams = globalThis.structuredClone(exportParams)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.export.cohort(plainExportParams)

    if (result !== null && result !== undefined && 'code' in result) {
      // Show error to user
      snackbar.value = {
        visible: true,
        message: `Export failed: ${result.message ?? result.userMessage ?? 'Unknown error'}`,
        color: 'error'
      }
    } else if (result !== null && result !== undefined && result.success === true) {
      // Show success to user
      snackbar.value = {
        visible: true,
        message: `Exported to ${result.filePath}`,
        color: 'success'
      }
    }
  } finally {
    exporting.value = false
  }
}

// Debounced filter application
const { debouncedFn: debouncedApplyFilters } = useDebounce(applyFilters, 300)

// Watch filter state and apply with debounce
watch(filters, () => debouncedApplyFilters(), { deep: true })

// Watch preset selections and sync with filter state
watch(selectedImpactPresets, () => debouncedApplyFilters())
watch(selectedCohortFreqPreset, (value) => {
  filters.value.minCohortFrequency = value
})
watch(selectedAfPreset, (value) => {
  filters.value.maxGnomadAf = value
})
watch(selectedCaddPreset, (value) => {
  filters.value.minCadd = value
  // Clear custom input when preset is selected
  if (value !== null) {
    customCadd.value = null
  }
})

// Custom input handlers - convert from user-friendly units to filter values
// Note: v-text-field emits string values even with v-model.number
const handleCustomCohortFreqChange = (value: string | number | null): void => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value
  if (numValue !== null && !Number.isNaN(numValue) && numValue > 0) {
    // Convert percentage (0-100) to decimal (0-1)
    filters.value.minCohortFrequency = numValue / 100
    selectedCohortFreqPreset.value = null // Clear preset when custom is used
  } else {
    // If cleared or invalid, only clear the filter if no preset is active
    if (selectedCohortFreqPreset.value === null) {
      filters.value.minCohortFrequency = null
    }
  }
}

const handleCustomGnomadAfChange = (value: string | number | null): void => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value
  if (numValue !== null && !Number.isNaN(numValue) && numValue > 0) {
    // Convert percentage (0-100) to decimal (0-1)
    filters.value.maxGnomadAf = numValue / 100
    selectedAfPreset.value = null // Clear preset when custom is used
  } else {
    // If cleared or invalid, only clear the filter if no preset is active
    if (selectedAfPreset.value === null) {
      filters.value.maxGnomadAf = null
    }
  }
}

const handleCustomCaddChange = (value: string | number | null): void => {
  const numValue = typeof value === 'string' ? parseFloat(value) : value
  if (numValue !== null && !Number.isNaN(numValue) && numValue >= 0) {
    filters.value.minCadd = numValue
    selectedCaddPreset.value = null // Clear preset when custom is used
  } else {
    // If cleared or invalid, only clear the filter if no preset is active
    if (selectedCaddPreset.value === null) {
      filters.value.minCadd = null
    }
  }
}

// Also clear custom inputs when presets are selected (bidirectional sync)
watch(selectedCohortFreqPreset, (value) => {
  if (value !== null) {
    customCohortFreq.value = null
  }
})

watch(selectedAfPreset, (value) => {
  if (value !== null) {
    customGnomadAf.value = null
  }
})

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

// Row click handler - track selection and emit event
const handleRowClick = (_event: unknown, { item }: { item: CohortVariant }): void => {
  selectedVariantKey.value = item.variant_key
  emit('row-click', item)
}

// Row props for zebra striping and selection highlighting
const getRowProps = ({ item, index }: { item: CohortVariant; index: number }) => {
  const classes: string[] = []

  // Zebra striping
  if (index % 2 === 1) {
    classes.push('variant-row--striped')
  }

  // Selection highlight
  if (item.variant_key === selectedVariantKey.value) {
    classes.push('variant-row--selected')
  }

  return { class: classes.join(' ') }
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

const formatScientific = (value: number): string => {
  if (value === 0) return '0'
  if (value >= 0.01) return value.toFixed(4)
  return value.toExponential(1)
}

// Color helper functions matching Case Analysis
const getImpactColor = (impact: string): string => {
  switch (impact) {
    case 'HIGH':
      return 'error'
    case 'MODERATE':
      return 'warning'
    case 'LOW':
      return 'info'
    case 'MODIFIER':
      return 'grey'
    default:
      return 'grey'
  }
}

const getClinvarColor = (clinvar: string): string => {
  const lower = clinvar.toLowerCase()
  if (lower.includes('pathogenic') && !lower.includes('benign')) return 'error'
  if (lower.includes('likely pathogenic')) return 'orange'
  if (lower.includes('uncertain') || lower.includes('vus')) return 'warning'
  if (lower.includes('likely benign')) return 'light-green'
  if (lower.includes('benign')) return 'success'
  return 'grey'
}

const getCaddColor = (cadd: number): string => {
  if (cadd >= 25) return 'error'
  if (cadd >= 20) return 'orange'
  if (cadd >= 15) return 'warning'
  if (cadd >= 10) return 'info'
  return 'grey'
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
  // Reload summary in parallel with variants
  void loadCohortSummary()
  await loadCohortVariants()
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
  const walk = (x - middleMouseStartX) * 2
  tableWrapperEl.scrollLeft = middleMouseScrollLeft - walk
}

const handleMouseUp = () => {
  if (isMiddleMouseDragging && tableWrapperEl) {
    isMiddleMouseDragging = false
    tableWrapperEl.style.cursor = ''
  }
}

const handleAuxClick = (e: MouseEvent) => {
  if (e.button === 1) {
    e.preventDefault()
  }
}

// Load data on mount and setup scroll handling
onMounted(async () => {
  // Load cohort summary for total count display (parallel with variants)
  void loadCohortSummary()
  await loadCohortVariants()

  await nextTick()

  // Find the table wrapper element

  const tableEl = dataTableRef.value?.$el as HTMLElement | undefined
  if (tableEl) {
    tableWrapperEl = tableEl.querySelector('.v-table__wrapper') as HTMLElement | null

    if (tableWrapperEl) {
      tableWrapperEl.addEventListener('scroll', handleTableScroll)
      tableWrapperEl.addEventListener('mousedown', handleMouseDown)
      // eslint-disable-next-line no-undef
      document.addEventListener('mousemove', handleMouseMove)
      // eslint-disable-next-line no-undef
      document.addEventListener('mouseup', handleMouseUp)
      tableWrapperEl.addEventListener('auxclick', handleAuxClick)

      updateTopScrollbarWidth()

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

// Expose refresh method to parent
defineExpose({ refresh })
</script>

<style scoped>
/* Import shared filter styles for DRY principle */
@import '../styles/_filter-common.scss';

/* Top scrollbar (synced with table) */
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

/* Clickable table rows with improved hover */
:deep(.v-data-table tbody tr) {
  cursor: pointer;
  transition: background-color 0.15s ease;
}

/* Zebra striping for better scanability */
:deep(.v-data-table tbody tr.variant-row--striped) {
  background-color: rgba(var(--v-theme-on-surface), 0.035);
}

/* Selected row highlighting - prominent with left accent border */
:deep(.v-data-table tbody tr.variant-row--selected) {
  background-color: rgba(var(--v-theme-primary), 0.12) !important;
  border-left: 4px solid rgb(var(--v-theme-primary)) !important;
}

:deep(.v-data-table tbody tr.variant-row--selected td:first-child) {
  padding-left: calc(16px - 4px);
}

/* Hover state - visible but subtle */
:deep(.v-data-table tbody tr:hover) {
  background-color: rgba(var(--v-theme-primary), 0.08) !important;
}

/* Selected + hover - slightly darker */
:deep(.v-data-table tbody tr.variant-row--selected:hover) {
  background-color: rgba(var(--v-theme-primary), 0.18) !important;
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
  background: rgba(var(--v-theme-on-surface), 0.05);
}

:deep(.v-table__wrapper)::-webkit-scrollbar-thumb {
  background: rgba(var(--v-theme-on-surface), 0.2);
  border-radius: 5px;
}

:deep(.v-table__wrapper)::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--v-theme-on-surface), 0.35);
}

/* FilterToolbar-like styling for visual consistency */
.filter-toolbar-container {
  position: sticky;
  top: 48px; /* Below tabs */
  z-index: 3;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgb(var(--v-theme-surface));
}

.filter-toolbar {
  background: transparent !important;
  height: auto !important;
  align-items: flex-start !important;
  padding-top: 16px !important;
  padding-bottom: 16px !important;
}

/* Filter groups container - horizontal scrollable */
.filter-groups-scroll {
  flex: 1;
  overflow-x: auto;
  overflow-y: clip;
  min-width: 0;
  scrollbar-width: thin;
  padding-top: 4px;
}

.filter-groups-container {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  padding: 4px 2px;
  width: max-content;
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  min-width: fit-content;
}

.search-section {
  min-width: 180px;
}

.search-section .filter-input {
  width: 100%;
}

.gene-section {
  min-width: 140px;
}

.gene-section .filter-input {
  width: 100%;
}

.impact-section,
.cohort-freq-section,
.frequency-section,
.cadd-section {
  min-width: fit-content;
}

.func-section {
  min-width: 140px;
}

.func-section .func-select {
  min-width: 120px;
  max-width: 160px;
}

.clinvar-section {
  min-width: 140px;
}

.clinvar-section .clinvar-select {
  min-width: 120px;
  max-width: 160px;
}

.section-label {
  display: flex;
  align-items: center;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
  margin-bottom: 2px;
}

.section-label .v-icon {
  opacity: 0.7;
}

.filter-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
  background: rgba(var(--v-theme-primary), 0.04);
}

.filter-input :deep(.v-field) {
  border-radius: 6px;
}

.filter-input :deep(.v-field__input) {
  font-size: 0.85rem;
}

.results-section {
  display: grid;
  grid-template-columns: auto auto auto;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  flex-shrink: 0;
  align-self: flex-start;
}

.results-chip {
  font-size: 0.85rem;
}

.placeholder-cell {
  /* Empty cell placeholder for grid alignment */
}

/* Chip group styling in filter sections */
.filter-section :deep(.v-chip-group) {
  flex-wrap: nowrap;
}

.filter-section :deep(.v-chip) {
  margin: 2px;
}

/* Applied filters summary bar (matching FilterToolbar) */
.applied-filters-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 16px;
  background: rgba(var(--v-theme-primary), 0.04);
  border-top: 1px solid rgba(var(--v-border-color), 0.08);
}

.applied-filters-bar .v-chip {
  max-width: 200px;
}

.applied-filters-bar .v-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
