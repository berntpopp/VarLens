<template>
  <div class="filter-toolbar-container">
    <!-- Main filter bar -->
    <v-toolbar density="default" flat class="filter-toolbar px-3 py-3">
      <!-- Filter groups wrapper with scroll arrows -->
      <div class="filter-groups-wrapper">
        <v-btn
          v-if="canScrollLeft"
          icon="mdi-chevron-left"
          size="x-small"
          variant="text"
          class="scroll-arrow scroll-arrow-left"
          @click="scrollLeft"
        />

        <div ref="scrollContainer" class="filter-groups-scroll">
          <draggable
            v-model="orderedFilterGroups"
            class="filter-groups-container"
            item-key="id"
            :animation="200"
            handle=".drag-handle"
          >
            <template #item="{ element: group }">
              <div
                class="filter-section-wrapper"
                :class="{ collapsed: !group.active }"
                :data-filter-id="group.id"
              >
                <div class="filter-group-header">
                  <v-icon class="drag-handle" size="x-small">mdi-drag-vertical</v-icon>
                  <v-btn
                    size="x-small"
                    variant="text"
                    density="compact"
                    :icon="group.active ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    @click="toggleFilterGroupActive(group.id)"
                  />
                </div>

                <div v-if="group.active" class="filter-group-content">
                  <!-- GENERAL SEARCH GROUP -->
                  <div v-if="group.id === 'search'" class="filter-section search-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-magnify</v-icon>
                      <span>Search</span>
                    </div>
                    <v-text-field
                      v-model="filters.searchQuery"
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Gene, chr:pos, c./p. HGVS..."
                      prepend-inner-icon="mdi-magnify"
                      class="filter-input"
                      :class="{ 'filter-active': filters.searchQuery !== '' }"
                    />
                  </div>

                  <!-- GENE SEARCH GROUP -->
                  <div v-if="group.id === 'gene'" class="filter-section gene-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-dna</v-icon>
                      <span>Gene</span>
                    </div>
                    <v-autocomplete
                      v-model="filters.geneSymbol"
                      :items="geneSymbolSuggestions"
                      :loading="loadingSuggestions"
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Search gene symbol (e.g. BRCA1)"
                      prepend-inner-icon="mdi-magnify"
                      class="filter-input"
                      :class="{ 'filter-active': filters.geneSymbol !== '' }"
                      @update:search="searchGeneSymbols"
                    />
                  </div>

                  <!-- VARIANT EFFECT GROUP -->
                  <div v-if="group.id === 'impact'" class="filter-section effect-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-flash</v-icon>
                      <span>Impact</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by predicted variant impact. HIGH: loss of function. MODERATE:
                          missense. LOW: synonymous.</span
                        >
                      </v-tooltip>
                    </div>
                    <div class="d-flex align-center ga-1">
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
                      <v-select
                        v-model="filters.consequences"
                        :items="filterOptions.consequences"
                        multiple
                        chips
                        closable-chips
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Specific..."
                        class="filter-input consequence-select"
                        :class="{ 'filter-active': filters.consequences.length > 0 }"
                      />
                    </div>
                  </div>

                  <!-- FUNCTIONAL ANNOTATION GROUP -->
                  <div v-if="group.id === 'function'" class="filter-section func-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-function</v-icon>
                      <span>Function</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by functional annotation: exonic, intronic, UTR, intergenic,
                          etc.</span
                        >
                      </v-tooltip>
                    </div>
                    <v-select
                      v-model="filters.funcs"
                      :items="filterOptions.funcs"
                      multiple
                      chips
                      closable-chips
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Select..."
                      class="filter-input func-select"
                      :class="{ 'filter-active': filters.funcs.length > 0 }"
                    />
                  </div>

                  <!-- CLINVAR GROUP -->
                  <div v-if="group.id === 'clinvar'" class="filter-section clinvar-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-hospital-box</v-icon>
                      <span>ClinVar</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by ClinVar pathogenicity classification: Pathogenic, Likely
                          pathogenic, VUS, Benign, etc.</span
                        >
                      </v-tooltip>
                    </div>
                    <v-select
                      v-model="filters.clinvars"
                      :items="filterOptions.clinvars"
                      multiple
                      chips
                      closable-chips
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Select..."
                      class="filter-input clinvar-select"
                      :class="{ 'filter-active': filters.clinvars.length > 0 }"
                    />
                  </div>

                  <!-- POPULATION FREQUENCY GROUP -->
                  <div v-if="group.id === 'frequency'" class="filter-section frequency-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-account-group</v-icon>
                      <span>Frequency</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Maximum gnomAD allele frequency. Lower = rarer in population. Unknown
                          frequencies are included.</span
                        >
                      </v-tooltip>
                    </div>
                    <div class="d-flex align-center ga-1">
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
                        v-model.number="filters.maxGnomadAf"
                        type="number"
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Custom"
                        class="filter-input custom-input"
                        :class="{ 'filter-active': filters.maxGnomadAf !== null }"
                        step="0.0001"
                        min="0"
                        max="1"
                      />
                    </div>
                  </div>

                  <!-- PATHOGENICITY GROUP -->
                  <div v-if="group.id === 'cadd'" class="filter-section pathogenicity-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-alert-circle</v-icon>
                      <span>CADD</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Minimum CADD phred score. Higher = more likely deleterious. 15+ moderate,
                          20+ high, 25+ very high. Unknown CADD included.</span
                        >
                      </v-tooltip>
                    </div>
                    <div class="d-flex align-center ga-1">
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
                        v-model.number="filters.minCadd"
                        type="number"
                        density="compact"
                        variant="outlined"
                        hide-details
                        clearable
                        placeholder="Custom"
                        class="filter-input custom-input"
                        :class="{ 'filter-active': filters.minCadd !== null }"
                        step="1"
                        min="0"
                      />
                    </div>
                  </div>

                  <!-- TAGS GROUP -->
                  <div v-if="group.id === 'tags'" class="filter-section tags-section">
                    <div class="section-label">
                      <v-icon size="small" class="mr-1">mdi-tag-multiple</v-icon>
                      <span>Tags</span>
                      <v-tooltip location="top" max-width="280">
                        <template #activator="{ props: tooltipProps }">
                          <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                            >mdi-information-outline</v-icon
                          >
                        </template>
                        <span
                          >Filter by variant tags. Selecting multiple tags shows variants with ANY
                          of the selected tags (OR logic).</span
                        >
                      </v-tooltip>
                    </div>
                    <v-select
                      v-model="filters.tagIds"
                      :items="availableTags"
                      item-title="name"
                      item-value="id"
                      multiple
                      chips
                      closable-chips
                      density="compact"
                      variant="outlined"
                      hide-details
                      clearable
                      placeholder="Select..."
                      class="filter-input tags-select"
                      :class="{ 'filter-active': filters.tagIds.length > 0 }"
                    >
                      <template #chip="{ item }">
                        <v-chip
                          closable
                          size="small"
                          :color="(item.raw as Tag).color"
                          variant="flat"
                          @click:close="removeTagFilter((item.raw as Tag).id)"
                        >
                          {{ (item.raw as Tag).name }}
                        </v-chip>
                      </template>
                      <template #item="{ item, props: itemProps }">
                        <v-list-item v-bind="itemProps" :title="undefined">
                          <template #prepend>
                            <v-icon :color="(item.raw as Tag).color" size="small"
                              >mdi-circle</v-icon
                            >
                          </template>
                          <v-list-item-title>{{ (item.raw as Tag).name }}</v-list-item-title>
                        </v-list-item>
                      </template>
                    </v-select>
                  </div>
                </div>
              </div>
            </template>
          </draggable>
        </div>

        <v-btn
          v-if="canScrollRight"
          icon="mdi-chevron-right"
          size="x-small"
          variant="text"
          class="scroll-arrow scroll-arrow-right"
          @click="scrollRight"
        />
      </div>

      <!-- RESULTS & ACTIONS -->
      <div class="results-section d-flex align-center ga-2 ml-auto">
        <v-chip
          :color="hasActiveFilters ? 'primary' : 'default'"
          :variant="hasActiveFilters ? 'flat' : 'tonal'"
          size="small"
          class="results-chip"
        >
          <v-icon start size="small">mdi-filter-variant</v-icon>
          <strong>{{ filteredCount.toLocaleString() }}</strong>
          <span class="mx-1 text-medium-emphasis">/</span>
          <span class="text-medium-emphasis">{{ totalCount.toLocaleString() }}</span>
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

        <v-divider vertical class="divider-subtle" />

        <!-- Column visibility menu -->
        <ColumnVisibilityMenu
          v-if="columns && columns.length > 0"
          :columns="orderedColumns"
          :visible-columns="visibleColumnKeys"
          table-id="variant-table"
          @toggle:column="toggleColumnVisibility"
          @reorder="setColumnOrder"
          @reset="resetColumnDefaults"
        />

        <!-- Export to Excel button -->
        <v-tooltip location="top">
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :loading="exporting"
              :disabled="filteredCount === 0"
              color="success"
              variant="tonal"
              size="small"
              prepend-icon="mdi-microsoft-excel"
              @click="exportToExcel"
            >
              Export
            </v-btn>
          </template>
          <span>Export {{ filteredCount.toLocaleString() }} variants to Excel</span>
        </v-tooltip>
      </div>
    </v-toolbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import draggable from 'vuedraggable'
import { useDebounce } from '../composables/useDebounce'
import { useTags } from '../composables/useTags'
import { useFilterPreferences } from '../composables/useFilterPreferences'
import { useColumnPreferences } from '../composables/useColumnPreferences'
import ColumnVisibilityMenu from './ColumnVisibilityMenu.vue'
import type { VariantFilter, Variant, Tag } from '../../../shared/types/api'

interface ColumnDef {
  key: string
  title: string
}

interface Props {
  caseId: number
  caseName: string
  filteredCount: number
  totalCount: number
  hasSort?: boolean
  initialSearch?: string
  columns?: ColumnDef[]
}

const props = defineProps<Props>()

// Export state
const exporting = ref(false)

interface Emits {
  (e: 'update:filters', filters: Omit<VariantFilter, 'case_id'>): void
  (e: 'reset-sort'): void
}

const emit = defineEmits<Emits>()

// Tags composable
const { loadTags, getTags } = useTags()

// Filter preferences composable
const { filterGroups, setFilterGroupOrder, toggleFilterGroupActive } = useFilterPreferences()

// Column preferences composable
const {
  prefs: columnPrefs,
  resetToDefaults: resetColumnDefaults,
  toggleColumnVisibility,
  setColumnOrder
} = useColumnPreferences('variant-table')

// Computed columns for ColumnVisibilityMenu
const orderedColumns = computed(() => {
  if (!props.columns) return []
  if (columnPrefs.value.order.length > 0) {
    return [...props.columns].sort((a, b) => {
      const aIdx = columnPrefs.value.order.indexOf(a.key)
      const bIdx = columnPrefs.value.order.indexOf(b.key)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })
  }
  return props.columns
})

const visibleColumnKeys = computed(() => {
  return orderedColumns.value
    .filter((h) => columnPrefs.value.visibility[h.key] !== false)
    .map((h) => h.key)
})

// Horizontal scroll state
const scrollContainer = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

// Ordered filter groups with two-way binding for draggable
const orderedFilterGroups = computed({
  get: () => filterGroups.value,
  set: (newOrder) => {
    setFilterGroupOrder(newOrder.map((g) => g.id))
  }
})

// Update scroll button visibility
const updateScrollButtons = () => {
  if (!scrollContainer.value) return
  const el = scrollContainer.value
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
}

// Scroll left
const scrollLeft = () => {
  scrollContainer.value?.scrollBy({ left: -200, behavior: 'smooth' })
}

// Scroll right
const scrollRight = () => {
  scrollContainer.value?.scrollBy({ left: 200, behavior: 'smooth' })
}

// Filter state
const filters = ref({
  searchQuery: '',
  geneSymbol: '',
  consequences: [] as string[],
  funcs: [] as string[],
  clinvars: [] as string[],
  maxGnomadAf: null as number | null,
  minCadd: null as number | null,
  tagIds: [] as number[]
})

// Available tags for filter
const availableTags = computed(() => getTags())

// Filter options loaded from database
const filterOptions = ref({
  consequences: [] as string[],
  funcs: [] as string[],
  clinvars: [] as string[],
  minCadd: null as number | null,
  maxCadd: null as number | null,
  minGnomadAf: null as number | null,
  maxGnomadAf: null as number | null
})

// Gene autocomplete state
const geneSymbolSuggestions = ref<string[]>([])
const loadingSuggestions = ref(false)

// Preset values
const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
]

const caddPresets = [
  { label: '10', value: 10 },
  { label: '15', value: 15 },
  { label: '20', value: 20 },
  { label: '25', value: 25 }
]

// Impact level presets for quick filtering
const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
]

// Selected impact presets (multi-select)
const selectedImpactPresets = ref<string[]>([])

// Selected preset values (synced bidirectionally)
const selectedAfPreset = ref<number | null>(null)
const selectedCaddPreset = ref<number | null>(null)

// Computed properties
const hasActiveFilters = computed(() => {
  const afActive =
    filters.value.maxGnomadAf !== null &&
    Number.isNaN(filters.value.maxGnomadAf) === false &&
    filters.value.maxGnomadAf > 0
  const caddActive =
    filters.value.minCadd !== null &&
    Number.isNaN(filters.value.minCadd) === false &&
    filters.value.minCadd >= 0

  return (
    filters.value.searchQuery !== '' ||
    filters.value.geneSymbol !== '' ||
    selectedImpactPresets.value.length > 0 ||
    filters.value.consequences.length > 0 ||
    filters.value.funcs.length > 0 ||
    filters.value.clinvars.length > 0 ||
    afActive ||
    caddActive ||
    filters.value.tagIds.length > 0 ||
    props.hasSort === true
  )
})

// Remove a tag from the filter
const removeTagFilter = (tagId: number) => {
  filters.value.tagIds = filters.value.tagIds.filter((id) => id !== tagId)
}

// Watch initialSearch prop to pre-populate search from cohort navigation
watch(
  () => props.initialSearch,
  (newSearch) => {
    if (newSearch !== undefined && newSearch !== '') {
      filters.value.searchQuery = newSearch
    }
  },
  { immediate: true }
)

// Load filter options on mount
onMounted(async () => {
  // Guard for browser dev mode
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
    return
  }

  try {
    // Load filter options and tags in parallel
    const [options] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
      (window as any).api.variants.getFilterOptions(props.caseId),
      loadTags()
    ])
    filterOptions.value = options
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load filter options:', error)
  }

  // Setup scroll listeners
  scrollContainer.value?.addEventListener('scroll', updateScrollButtons)
  // eslint-disable-next-line no-undef
  window.addEventListener('resize', updateScrollButtons)
  updateScrollButtons()
})

onBeforeUnmount(() => {
  scrollContainer.value?.removeEventListener('scroll', updateScrollButtons)
  // eslint-disable-next-line no-undef
  window.removeEventListener('resize', updateScrollButtons)
})

// Gene symbol autocomplete using FTS5 search (FLT-06 implementation)
const searchGeneSymbols = async (query: string) => {
  if (!query || query.length < 2) {
    geneSymbolSuggestions.value = []
    return
  }

  loadingSuggestions.value = true
  try {
    // FTS5 search via IPC (FLT-06 implementation)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const results: Variant[] = await (window as any).api.variants.search(props.caseId, query, 20)
    // Extract unique gene symbols from FTS5 results
    geneSymbolSuggestions.value = [
      ...new Set(results.map((v) => v.gene_symbol).filter((s): s is string => s !== null))
    ]
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Gene search failed:', error)
    geneSymbolSuggestions.value = []
  } finally {
    loadingSuggestions.value = false
  }
}

// Emit filter updates with debounce
const emitFilters = () => {
  const variantFilter: Omit<VariantFilter, 'case_id'> = {}

  if (filters.value.searchQuery !== '') {
    variantFilter.search_query = filters.value.searchQuery
  }

  if (filters.value.geneSymbol !== '') {
    variantFilter.gene_symbol = filters.value.geneSymbol
  }

  // Combine impact presets with specific consequences (OR logic)
  const allConsequences = [...selectedImpactPresets.value, ...filters.value.consequences]
  if (allConsequences.length > 0) {
    variantFilter.consequences = [...new Set(allConsequences)] // Dedupe
  }

  // Add funcs filter
  if (filters.value.funcs.length > 0) {
    variantFilter.funcs = filters.value.funcs
  }

  // Add clinvars filter
  if (filters.value.clinvars.length > 0) {
    variantFilter.clinvars = filters.value.clinvars
  }

  // Only include gnomAD AF if it's a valid positive number
  const afValue = filters.value.maxGnomadAf
  if (afValue !== null && Number.isNaN(afValue) === false && afValue > 0) {
    variantFilter.gnomad_af_max = afValue
  }

  // Only include CADD if it's a valid non-negative number
  const caddValue = filters.value.minCadd
  if (caddValue !== null && Number.isNaN(caddValue) === false && caddValue >= 0) {
    variantFilter.cadd_min = caddValue
  }

  // Add tag filter
  if (filters.value.tagIds.length > 0) {
    variantFilter.tag_ids = filters.value.tagIds
  }

  emit('update:filters', variantFilter)
}

// Create debounced version
const { debouncedFn: debouncedEmit } = useDebounce(emitFilters, 300)

// Watch filters and emit changes
watch(
  filters,
  () => {
    debouncedEmit()
  },
  { deep: true }
)

// Watch preset selections and sync with text inputs
watch(selectedAfPreset, (value) => {
  if (value !== null) {
    filters.value.maxGnomadAf = value
  }
})

watch(selectedCaddPreset, (value) => {
  if (value !== null) {
    filters.value.minCadd = value
  }
})

// Watch impact presets and emit filter changes
watch(selectedImpactPresets, () => {
  debouncedEmit()
})

// Watch text inputs and sync with preset selections
watch(
  () => filters.value.maxGnomadAf,
  (value) => {
    if (value !== null) {
      // Check if value matches a preset
      const matchingPreset = afPresets.find((p) => p.value === value)
      selectedAfPreset.value = matchingPreset !== undefined ? matchingPreset.value : null
    } else {
      selectedAfPreset.value = null
    }
  }
)

watch(
  () => filters.value.minCadd,
  (value) => {
    if (value !== null) {
      // Check if value matches a preset
      const matchingPreset = caddPresets.find((p) => p.value === value)
      selectedCaddPreset.value = matchingPreset !== undefined ? matchingPreset.value : null
    } else {
      selectedCaddPreset.value = null
    }
  }
)

// Clear all filters and reset sort
const clearAllFilters = () => {
  filters.value.searchQuery = ''
  filters.value.geneSymbol = ''
  filters.value.consequences = []
  filters.value.funcs = []
  filters.value.clinvars = []
  filters.value.maxGnomadAf = null
  filters.value.minCadd = null
  filters.value.tagIds = []
  selectedAfPreset.value = null
  selectedCaddPreset.value = null
  selectedImpactPresets.value = []
  // Also reset sort order in parent
  emit('reset-sort')
}

// Export to Excel
const exportToExcel = async () => {
  // Guard for browser dev mode
  // eslint-disable-next-line no-undef
  if (typeof window.api === 'undefined') {
    // eslint-disable-next-line no-undef
    console.warn('window.api not available - running outside Electron')
    return
  }

  exporting.value = true
  try {
    // Build current filter state
    const exportFilters: Omit<VariantFilter, 'case_id'> = {}

    if (filters.value.searchQuery !== '') {
      exportFilters.search_query = filters.value.searchQuery
    }

    if (filters.value.geneSymbol !== '') {
      exportFilters.gene_symbol = filters.value.geneSymbol
    }

    const allConsequences = [...selectedImpactPresets.value, ...filters.value.consequences]
    if (allConsequences.length > 0) {
      exportFilters.consequences = [...new Set(allConsequences)]
    }

    if (filters.value.funcs.length > 0) {
      exportFilters.funcs = filters.value.funcs
    }

    if (filters.value.clinvars.length > 0) {
      exportFilters.clinvars = filters.value.clinvars
    }

    const afValue = filters.value.maxGnomadAf
    if (afValue !== null && Number.isNaN(afValue) === false && afValue > 0) {
      exportFilters.gnomad_af_max = afValue
    }

    const caddValue = filters.value.minCadd
    if (caddValue !== null && Number.isNaN(caddValue) === false && caddValue >= 0) {
      exportFilters.cadd_min = caddValue
    }

    if (filters.value.tagIds.length > 0) {
      exportFilters.tag_ids = filters.value.tagIds
    }

    // eslint-disable-next-line no-undef
    console.log('Exporting with caseName:', props.caseName, 'caseId:', props.caseId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.export.variants(
      props.caseId,
      exportFilters,
      props.caseName !== '' ? props.caseName : `case_${props.caseId}`
    )

    // eslint-disable-next-line no-undef
    console.log('Export result:', result)

    // Check for error response (SerializableError has code property)
    if (result !== null && result !== undefined && 'code' in result) {
      // eslint-disable-next-line no-undef
      console.error('Export error:', result.message ?? result.userMessage)
      return
    }

    if (result !== null && result !== undefined && result.success === true) {
      // eslint-disable-next-line no-undef
      console.log('Export successful:', result.filePath)
    } else if (
      result !== null &&
      result !== undefined &&
      typeof result.error === 'string' &&
      result.error !== 'Export cancelled'
    ) {
      // eslint-disable-next-line no-undef
      console.error('Export failed:', result.error)
    }
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Export error:', error)
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.filter-toolbar-container {
  border-bottom: 1px solid rgba(var(--v-border-color), 0.12);
  background: rgb(var(--v-theme-surface));
}

.filter-toolbar {
  background: transparent !important;
  height: auto !important;
  align-items: flex-start !important;
  padding-top: 8px !important;
  padding-bottom: 8px !important;
}

.filter-groups-wrapper {
  display: flex;
  align-items: flex-start;
  flex: 1;
  min-width: 0;
  gap: 4px;
}

.filter-groups-scroll {
  flex: 1;
  overflow-x: auto;
  scrollbar-width: thin;
  min-width: 0;
}

.filter-groups-scroll::-webkit-scrollbar {
  height: 6px;
}

.filter-groups-scroll::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.filter-groups-container {
  display: flex;
  flex-direction: row;
  gap: 6px;
  padding: 2px;
}

.filter-section-wrapper {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 2px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  padding: 4px;
}

.filter-section-wrapper.collapsed {
  padding: 4px 8px;
}

.filter-group-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding-top: 2px;
}

.drag-handle {
  cursor: grab;
  opacity: 0.4;
  transition: opacity 0.2s;
}

.drag-handle:hover {
  opacity: 0.8;
}

.drag-handle:active {
  cursor: grabbing;
}

.filter-group-content {
  flex: 1;
}

.scroll-arrow {
  flex-shrink: 0;
  align-self: center;
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 4px;
  min-width: fit-content;
}

.search-section {
  min-width: 160px;
}

.search-section .filter-input {
  width: 100%;
}

.gene-section {
  min-width: 160px;
}

.gene-section .filter-input {
  width: 100%;
}

.effect-section .consequence-select {
  max-width: 130px;
}

.func-section .func-select {
  min-width: 120px;
  max-width: 160px;
}

.clinvar-section .clinvar-select {
  min-width: 140px;
  max-width: 180px;
}

.tags-section .tags-select {
  min-width: 120px;
  max-width: 180px;
}

.custom-input {
  max-width: 90px;
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
}

.section-label .v-icon {
  opacity: 0.7;
}

.info-icon {
  opacity: 0.5;
  cursor: help;
}

.info-icon:hover {
  opacity: 1;
}

.divider-subtle {
  opacity: 0.3;
}

.filter-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
}

.filter-input :deep(.v-field) {
  border-radius: 6px;
}

.filter-input :deep(.v-field__input) {
  font-size: 0.85rem;
}

.results-chip {
  font-size: 0.85rem;
}

.results-section {
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  flex-shrink: 0;
  align-self: flex-start;
}

/* Collapsed filter group - just show small indicator */
.filter-section-wrapper.collapsed .filter-group-header {
  flex-direction: row;
}
</style>
