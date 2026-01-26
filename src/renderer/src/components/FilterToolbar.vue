<template>
  <div class="filter-toolbar-container">
    <!-- Main filter bar -->
    <v-toolbar density="default" flat class="filter-toolbar px-3 py-3">
      <!-- GENE SEARCH GROUP -->
      <div class="filter-section gene-section">
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

      <v-divider vertical class="mx-2 divider-subtle" />

      <!-- VARIANT EFFECT GROUP -->
      <div class="filter-section effect-section">
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
              >Filter by predicted variant impact. HIGH: loss of function. MODERATE: missense. LOW:
              synonymous.</span
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

      <v-divider vertical class="mx-2 divider-subtle" />

      <!-- FUNCTIONAL ANNOTATION GROUP -->
      <div class="filter-section func-section">
        <div class="section-label">
          <v-icon size="small" class="mr-1">mdi-function</v-icon>
          <span>Function</span>
          <v-tooltip location="top" max-width="280">
            <template #activator="{ props: tooltipProps }">
              <v-icon v-bind="tooltipProps" size="x-small" class="ml-1 info-icon"
                >mdi-information-outline</v-icon
              >
            </template>
            <span>Filter by functional annotation: exonic, intronic, UTR, intergenic, etc.</span>
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

      <v-divider vertical class="mx-2 divider-subtle" />

      <!-- CLINVAR GROUP -->
      <div class="filter-section clinvar-section">
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
              >Filter by ClinVar clinical significance: Pathogenic, Likely pathogenic, VUS, Benign,
              etc.</span
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

      <v-divider vertical class="mx-2 divider-subtle" />

      <!-- POPULATION FREQUENCY GROUP -->
      <div class="filter-section frequency-section">
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
              >Maximum gnomAD allele frequency. Lower = rarer in population. Unknown frequencies are
              included.</span
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

      <v-divider vertical class="mx-2 divider-subtle" />

      <!-- PATHOGENICITY GROUP -->
      <div class="filter-section pathogenicity-section">
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
              >Minimum CADD phred score. Higher = more likely deleterious. 15+ moderate, 20+ high,
              25+ very high. Unknown CADD included.</span
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

      <v-spacer />

      <!-- RESULTS & ACTIONS -->
      <div class="results-section d-flex align-center ga-2">
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
import { ref, computed, watch, onMounted } from 'vue'
import { useDebounce } from '../composables/useDebounce'
import type { VariantFilter, Variant } from '../../../shared/types/api'

interface Props {
  caseId: number
  caseName: string
  filteredCount: number
  totalCount: number
  hasSort?: boolean
}

const props = defineProps<Props>()

// Export state
const exporting = ref(false)

interface Emits {
  (e: 'update:filters', filters: Omit<VariantFilter, 'case_id'>): void
  (e: 'reset-sort'): void
}

const emit = defineEmits<Emits>()

// Filter state
const filters = ref({
  geneSymbol: '',
  consequences: [] as string[],
  funcs: [] as string[],
  clinvars: [] as string[],
  maxGnomadAf: null as number | null,
  minCadd: null as number | null
})

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
    !Number.isNaN(filters.value.maxGnomadAf) &&
    filters.value.maxGnomadAf > 0
  const caddActive =
    filters.value.minCadd !== null &&
    !Number.isNaN(filters.value.minCadd) &&
    filters.value.minCadd >= 0

  return (
    filters.value.geneSymbol !== '' ||
    selectedImpactPresets.value.length > 0 ||
    filters.value.consequences.length > 0 ||
    filters.value.funcs.length > 0 ||
    filters.value.clinvars.length > 0 ||
    afActive ||
    caddActive ||
    props.hasSort === true
  )
})

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    filterOptions.value = await (window as any).api.variants.getFilterOptions(props.caseId)
  } catch (error) {
    // eslint-disable-next-line no-undef
    console.error('Failed to load filter options:', error)
  }
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
  if (afValue !== null && !Number.isNaN(afValue) && afValue > 0) {
    variantFilter.gnomad_af_max = afValue
  }

  // Only include CADD if it's a valid non-negative number
  const caddValue = filters.value.minCadd
  if (caddValue !== null && !Number.isNaN(caddValue) && caddValue >= 0) {
    variantFilter.cadd_min = caddValue
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
      selectedAfPreset.value = matchingPreset ? matchingPreset.value : null
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
      selectedCaddPreset.value = matchingPreset ? matchingPreset.value : null
    } else {
      selectedCaddPreset.value = null
    }
  }
)

// Clear all filters and reset sort
const clearAllFilters = () => {
  filters.value.geneSymbol = ''
  filters.value.consequences = []
  filters.value.funcs = []
  filters.value.clinvars = []
  filters.value.maxGnomadAf = null
  filters.value.minCadd = null
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
    if (afValue !== null && !Number.isNaN(afValue) && afValue > 0) {
      exportFilters.gnomad_af_max = afValue
    }

    const caddValue = filters.value.minCadd
    if (caddValue !== null && !Number.isNaN(caddValue) && caddValue >= 0) {
      exportFilters.cadd_min = caddValue
    }

    // eslint-disable-next-line no-undef
    console.log('Exporting with caseName:', props.caseName, 'caseId:', props.caseId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-undef
    const result = await (window as any).api.export.variants(
      props.caseId,
      exportFilters,
      props.caseName || `case_${props.caseId}`
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
  overflow-x: auto;
  min-height: 100px;
}

.filter-toolbar {
  background: transparent !important;
  min-width: max-content;
  min-height: 96px !important;
  height: auto !important;
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  min-width: fit-content;
}

.gene-section {
  min-width: 220px;
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
}

/* Responsive adjustments */
@media (max-width: 1400px) {
  .filter-section {
    padding: 2px 6px;
  }

  .gene-section {
    min-width: 180px;
  }
}
</style>
