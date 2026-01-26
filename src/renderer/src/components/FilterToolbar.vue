<template>
  <v-toolbar density="compact" flat class="filter-toolbar pa-2">
    <!-- Gene symbol autocomplete (uses FTS5 via window.api.variants.search - FLT-06) -->
    <v-autocomplete
      v-model="filters.geneSymbol"
      :items="geneSymbolSuggestions"
      :loading="loadingSuggestions"
      density="compact"
      variant="outlined"
      hide-details
      clearable
      placeholder="Gene..."
      class="filter-input gene-input"
      :class="{ 'filter-active': filters.geneSymbol !== '' }"
      style="max-width: 180px"
      @update:search="searchGeneSymbols"
    />

    <!-- Impact level quick presets -->
    <v-chip-group v-model="selectedImpactPresets" multiple class="ml-2">
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

    <!-- Consequence multi-select (for specific consequences) -->
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
      placeholder="More..."
      class="filter-input consequence-input ml-2"
      :class="{ 'filter-active': filters.consequences.length > 0 }"
      style="max-width: 150px"
    />

    <v-divider vertical class="mx-3" />

    <!-- AF filter with presets -->
    <div class="filter-group d-flex align-center">
      <v-tooltip location="top" max-width="250">
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="text-caption mr-2 cursor-help">Max AF:</span>
        </template>
        <span
          >Maximum gnomAD allele frequency. Lower = rarer variants. Variants with unknown AF are
          included.</span
        >
      </v-tooltip>
      <v-chip-group v-model="selectedAfPreset" class="mr-2">
        <v-chip
          v-for="preset in afPresets"
          :key="preset.value"
          :value="preset.value"
          filter
          variant="outlined"
          size="small"
          color="primary"
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
        class="filter-input af-input"
        :class="{ 'filter-active': filters.maxGnomadAf !== null }"
        style="max-width: 120px"
        step="0.0001"
        min="0"
        max="1"
      />
    </div>

    <v-divider vertical class="mx-3" />

    <!-- CADD filter with presets -->
    <div class="filter-group d-flex align-center">
      <v-tooltip location="top" max-width="250">
        <template #activator="{ props: tooltipProps }">
          <span v-bind="tooltipProps" class="text-caption mr-2 cursor-help">Min CADD:</span>
        </template>
        <span
          >Minimum CADD phred score. Higher = more likely deleterious (15+ suggested, 20+ high).
          Variants without CADD scores are excluded.</span
        >
      </v-tooltip>
      <v-chip-group v-model="selectedCaddPreset" class="mr-2">
        <v-chip
          v-for="preset in caddPresets"
          :key="preset.value"
          :value="preset.value"
          filter
          variant="outlined"
          size="small"
          color="secondary"
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
        class="filter-input cadd-input"
        :class="{ 'filter-active': filters.minCadd !== null }"
        style="max-width: 120px"
        step="1"
        min="0"
      />
    </div>

    <v-spacer />

    <!-- Result count - always show X of Y format -->
    <v-chip
      :color="hasActiveFilters ? 'primary' : 'default'"
      :variant="hasActiveFilters ? 'flat' : 'text'"
      size="small"
      class="mr-2"
    >
      <strong>{{ filteredCount.toLocaleString() }}</strong>
      <span class="mx-1">/</span>
      <span>{{ totalCount.toLocaleString() }}</span>
      <span class="ml-1 text-caption">variants</span>
    </v-chip>

    <!-- Clear All button - always visible, disabled when no filters -->
    <v-btn
      :disabled="!hasActiveFilters"
      :color="hasActiveFilters ? 'error' : undefined"
      variant="text"
      size="small"
      prepend-icon="mdi-filter-off"
      @click="clearAllFilters"
    >
      Clear
    </v-btn>
  </v-toolbar>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useDebounce } from '../composables/useDebounce'
import type { VariantFilter, Variant } from '../../../shared/types/api'

interface Props {
  caseId: number
  filteredCount: number
  totalCount: number
}

const props = defineProps<Props>()

interface Emits {
  (e: 'update:filters', filters: Omit<VariantFilter, 'case_id'>): void
}

const emit = defineEmits<Emits>()

// Filter state
const filters = ref({
  geneSymbol: '',
  consequences: [] as string[],
  maxGnomadAf: null as number | null,
  minCadd: null as number | null
})

// Filter options loaded from database
const filterOptions = ref({
  consequences: [] as string[],
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
    afActive ||
    caddActive
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

// Clear all filters
const clearAllFilters = () => {
  filters.value.geneSymbol = ''
  filters.value.consequences = []
  filters.value.maxGnomadAf = null
  filters.value.minCadd = null
  selectedAfPreset.value = null
  selectedCaddPreset.value = null
  selectedImpactPresets.value = []
}
</script>

<style scoped>
.filter-toolbar {
  border-bottom: 1px solid rgba(0, 0, 0, 0.12);
}

.filter-input.filter-active {
  border-color: rgb(var(--v-theme-primary));
}

.filter-input.filter-active :deep(.v-field) {
  border-color: rgb(var(--v-theme-primary));
  border-width: 2px;
}

.filter-group {
  white-space: nowrap;
}

.cursor-help {
  cursor: help;
  border-bottom: 1px dotted currentColor;
}
</style>
