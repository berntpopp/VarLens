<template>
  <FilterDrawerShell
    :open="open"
    :active-filter-count="activeFilterCount"
    :expanded-panels="expandedPanels"
    :all-panel-values="allPanelValues"
    @update:open="emit('update:open', $event)"
    @update:expanded-panels="expandedPanels = $event"
    @clear-all="clearAllFilters"
  >
    <v-expansion-panels v-model="expandedPanels" multiple variant="accordion">
      <!-- === VARIANT PROPERTIES === -->
      <div class="filter-section-header text-overline text-medium-emphasis px-3 pt-3 pb-1">
        Variant Properties
      </div>

      <!-- Search (ALWAYS first) -->
      <v-expansion-panel value="search">
        <FilterPanelTitle
          icon="mdi-magnify"
          label="Search"
          :active="isFilterGroupActive('search')"
          :value-summary="searchSummary"
        />
        <v-expansion-panel-text>
          <DslSearchBar
            v-if="dslInput"
            :raw-input="dslInput"
            :suggestions="dslSuggestions ?? []"
            :is-dsl-mode="isDslMode ?? false"
            :errors="dslErrors ?? []"
            @update:raw-input="dslInput = $event"
            @apply="onDslApply?.()"
            @clear="onDslClear?.()"
            @select-suggestion="onDslSuggestionSelect?.($event)"
          />
          <v-text-field
            v-else
            v-model="searchTerm"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Gene, position, HGVS..."
            prepend-inner-icon="mdi-magnify"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Preset chips (below Search, above remaining filters) -->
      <div
        v-if="visiblePresets && visiblePresets.length > 0"
        class="preset-drawer-section px-3 pt-2 pb-1"
      >
        <div class="d-flex align-center mb-1">
          <v-icon size="x-small" class="mr-1 text-medium-emphasis">mdi-bookmark-multiple</v-icon>
          <span class="text-overline text-medium-emphasis">Presets</span>
          <v-spacer />
          <v-btn
            v-if="hasActiveFiltersForSave"
            size="x-small"
            variant="text"
            color="primary"
            density="compact"
            @click="onPresetSave?.()"
          >
            Save
          </v-btn>
          <v-btn size="x-small" variant="text" density="compact" @click="onPresetManage?.()">
            <v-icon size="x-small">mdi-cog-outline</v-icon>
          </v-btn>
        </div>
        <div class="d-flex ga-1 flex-wrap pb-1">
          <v-chip
            v-for="preset in visiblePresets"
            :key="preset.id"
            :color="isPresetActive?.(preset.id) ? 'primary' : undefined"
            :variant="isPresetActive?.(preset.id) ? 'flat' : 'outlined'"
            size="small"
            label
            @click="onPresetToggle?.(preset.id)"
          >
            {{ preset.name }}
            <v-tooltip activator="parent" location="bottom">
              {{ preset.description || 'No description' }}
            </v-tooltip>
          </v-chip>
        </div>
        <v-divider class="mt-1" />
      </div>

      <!-- Gene -->
      <v-expansion-panel value="gene">
        <FilterPanelTitle
          icon="mdi-dna"
          label="Gene"
          :active="isFilterGroupActive('gene')"
          :value-summary="geneSummary"
        />
        <v-expansion-panel-text>
          <v-autocomplete
            v-model="filters.geneSymbol"
            :items="geneSymbolSuggestions"
            :loading="loadingGeneSuggestions"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Search gene symbol (e.g. BRCA1)"
            prepend-inner-icon="mdi-magnify"
            @update:search="searchGeneSymbols"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Impact -->
      <v-expansion-panel value="impact">
        <FilterPanelTitle
          icon="mdi-flash"
          label="Impact"
          :active="isFilterGroupActive('impact')"
          :value-summary="impactSummary"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap">
            <v-chip
              v-for="preset in impactPresets"
              :key="preset.value"
              :color="selectedImpactPresets.includes(preset.value) ? preset.color : undefined"
              :variant="selectedImpactPresets.includes(preset.value) ? 'flat' : 'outlined'"
              size="small"
              label
              @click="toggleImpactPreset(preset.value)"
            >
              {{ preset.label }}
            </v-chip>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Consequence (Function) -->
      <v-expansion-panel value="function">
        <FilterPanelTitle
          icon="mdi-function"
          label="Consequence"
          :active="isFilterGroupActive('function')"
          :value-summary="funcSummary"
        />
        <v-expansion-panel-text>
          <GroupedMultiSelect
            v-model="filters.funcs"
            :config="consequenceGroups"
            label="Consequence"
            placeholder="Select..."
            icon="mdi-function"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- ClinVar -->
      <v-expansion-panel value="clinvar">
        <FilterPanelTitle
          icon="mdi-hospital-box"
          label="ClinVar"
          :active="isFilterGroupActive('clinvar')"
          :value-summary="clinvarSummary"
        />
        <v-expansion-panel-text>
          <GroupedMultiSelect
            v-model="filters.clinvars"
            :config="clinvarGroups"
            label="ClinVar"
            placeholder="Select..."
            icon="mdi-hospital-box"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- === ANNOTATIONS === -->
      <div class="filter-section-header text-overline text-medium-emphasis px-3 pt-3 pb-1">
        <v-divider class="mb-2" />
        Annotations
      </div>

      <!-- Annotations (starred, comments, ACMG) -->
      <v-expansion-panel value="annotations">
        <FilterPanelTitle
          icon="mdi-star-circle"
          label="Annotations"
          :active="isFilterGroupActive('annotations')"
          :value-summary="annotationsSummary"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-2 mb-3">
            <v-btn
              :color="filters.starredOnly ? 'amber-darken-2' : undefined"
              :variant="filters.starredOnly ? 'flat' : 'outlined'"
              size="small"
              rounded="pill"
              @click="filters.starredOnly = !filters.starredOnly"
            >
              <v-icon size="small" start>mdi-star</v-icon>
              Starred
            </v-btn>
            <v-btn
              :color="filters.hasCommentOnly ? 'primary' : undefined"
              :variant="filters.hasCommentOnly ? 'flat' : 'outlined'"
              size="small"
              rounded="pill"
              @click="filters.hasCommentOnly = !filters.hasCommentOnly"
            >
              <v-icon size="small" start>mdi-comment-text</v-icon>
              Commented
            </v-btn>
          </div>
          <div class="text-body-small text-medium-emphasis mb-1">ACMG Classification</div>
          <div class="d-flex ga-1 flex-wrap">
            <v-chip
              v-for="cls in acmgFilterOptions"
              :key="cls.value"
              :color="filters.acmgClassifications.includes(cls.value) ? cls.color : undefined"
              :variant="filters.acmgClassifications.includes(cls.value) ? 'flat' : 'outlined'"
              size="small"
              label
              @click="toggleAcmgClassification(cls.value)"
            >
              {{ cls.label }}
            </v-chip>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- === POPULATION & SCORES === -->
      <div class="filter-section-header text-overline text-medium-emphasis px-3 pt-3 pb-1">
        <v-divider class="mb-2" />
        Population &amp; Scores
      </div>

      <!-- Cohort Frequency (unique to cohort view) -->
      <v-expansion-panel value="cohortFreq">
        <FilterPanelTitle
          icon="mdi-account-group"
          label="Cohort Freq"
          :active="isFilterGroupActive('cohortFreq')"
          :value-summary="cohortFreqSummary"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in cohortFreqPresets"
              :key="preset.value"
              :color="selectedCohortFreqPreset === preset.value ? 'primary' : undefined"
              :variant="selectedCohortFreqPreset === preset.value ? 'flat' : 'outlined'"
              size="small"
              label
              @click="
                selectedCohortFreqPreset =
                  selectedCohortFreqPreset === preset.value ? null : preset.value
              "
            >
              {{ preset.label }}
            </v-chip>
          </div>
          <v-text-field
            v-model.number="customCohortFreq"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="1"
            min="0"
            max="100"
            placeholder="Custom % (e.g. 15)"
            clearable
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- gnomAD AF -->
      <v-expansion-panel value="frequency">
        <FilterPanelTitle
          icon="mdi-earth"
          label="gnomAD AF"
          :active="isFilterGroupActive('frequency')"
          :value-summary="frequencySummary"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in afPresets"
              :key="preset.value"
              :color="selectedAfPreset === preset.value ? 'primary' : undefined"
              :variant="selectedAfPreset === preset.value ? 'flat' : 'outlined'"
              size="small"
              label
              @click="selectedAfPreset = selectedAfPreset === preset.value ? null : preset.value"
            >
              {{ preset.label }}
            </v-chip>
          </div>
          <v-text-field
            v-model.number="customGnomadAf"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="0.001"
            min="0"
            max="100"
            placeholder="Custom % (e.g. 0.5)"
            clearable
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- CADD -->
      <v-expansion-panel value="cadd">
        <FilterPanelTitle
          icon="mdi-alert-circle"
          label="CADD"
          :active="isFilterGroupActive('cadd')"
          :value-summary="caddSummary"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap mb-2">
            <v-chip
              v-for="preset in caddPresets"
              :key="preset.value"
              :color="selectedCaddPreset === preset.value ? 'primary' : undefined"
              :variant="selectedCaddPreset === preset.value ? 'flat' : 'outlined'"
              size="small"
              label
              @click="
                selectedCaddPreset = selectedCaddPreset === preset.value ? null : preset.value
              "
            >
              {{ preset.label }}
            </v-chip>
          </div>
          <v-text-field
            v-model.number="customCadd"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="1"
            min="0"
            max="60"
            placeholder="Min CADD score"
            clearable
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </FilterDrawerShell>
</template>

<script setup lang="ts">
import { inject, ref, computed } from 'vue'
import FilterDrawerShell from '../filters/FilterDrawerShell.vue'
import FilterPanelTitle from '../filters/FilterPanelTitle.vue'
import DslSearchBar from '../DslSearchBar.vue'
import GroupedMultiSelect from '../GroupedMultiSelect.vue'
import { consequenceGroups, clinvarGroups } from '../../config/filterGroups'
import { ACMG_FILTER_OPTIONS } from '../../utils/filters'
import type { CohortFilterDrawerState } from './cohortFilterDrawerTypes'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Panel state
const allPanelValues = [
  'search',
  'gene',
  'impact',
  'function',
  'clinvar',
  'annotations',
  'cohortFreq',
  'frequency',
  'cadd'
]
const expandedPanels = ref<string[]>(['search', 'impact', 'frequency'])

// Inject shared filter state from CohortFilterBar
const state = inject<CohortFilterDrawerState>('cohortFilterDrawerState')

if (!state) {
  throw new Error(
    'CohortFilterDrawer must be rendered inside CohortFilterBar (missing cohortFilterDrawerState)'
  )
}

// Destructure for template convenience
const {
  filters,
  searchTerm,
  geneSymbolSuggestions,
  loadingGeneSuggestions,
  selectedImpactPresets,
  selectedCohortFreqPreset,
  selectedAfPreset,
  selectedCaddPreset,
  customCohortFreq,
  customGnomadAf,
  customCadd,
  impactPresets,
  cohortFreqPresets,
  afPresets,
  caddPresets,
  activeFilterCount,
  isFilterGroupActive,
  clearAllFilters,
  searchGeneSymbols,
  visiblePresets,
  isPresetActive,
  onPresetToggle,
  onPresetSave,
  onPresetManage,
  hasActiveFiltersForSave,
  dslInput,
  dslSuggestions,
  isDslMode,
  dslErrors,
  onDslApply,
  onDslClear,
  onDslSuggestionSelect
} = state

// Value summaries for collapsed panel previews
const searchSummary = computed(() => searchTerm.value || '')
const geneSummary = computed(() => filters.value.geneSymbol || '')

const impactSummary = computed(() => {
  if (selectedImpactPresets.value.length > 0) {
    return selectedImpactPresets.value.join(', ')
  }
  return ''
})

const funcSummary = computed(() =>
  filters.value.funcs.length > 0 ? `${filters.value.funcs.length} selected` : ''
)

const clinvarSummary = computed(() =>
  filters.value.clinvars.length > 0 ? `${filters.value.clinvars.length} selected` : ''
)

const annotationsSummary = computed(() => {
  const parts: string[] = []
  if (filters.value.starredOnly) parts.push('Starred')
  if (filters.value.hasCommentOnly) parts.push('Comments')
  if (filters.value.acmgClassifications.length > 0) {
    parts.push(`ACMG: ${filters.value.acmgClassifications.length}`)
  }
  return parts.join(', ')
})

const cohortFreqSummary = computed(() => {
  if (filters.value.minCohortFrequency !== null && filters.value.minCohortFrequency > 0) {
    const pct = (filters.value.minCohortFrequency * 100).toFixed(1)
    return `>= ${pct}%`
  }
  return ''
})

const frequencySummary = computed(() => {
  if (filters.value.maxGnomadAf !== null && filters.value.maxGnomadAf > 0) {
    const pct = (filters.value.maxGnomadAf * 100).toFixed(2)
    return `<= ${pct}%`
  }
  return ''
})

const caddSummary = computed(() => {
  if (filters.value.minCadd !== null && filters.value.minCadd >= 0) {
    return `>= ${filters.value.minCadd}`
  }
  return ''
})

const acmgFilterOptions = ACMG_FILTER_OPTIONS

const toggleImpactPreset = (value: string): void => {
  const current = selectedImpactPresets.value
  if (current.includes(value)) {
    selectedImpactPresets.value = current.filter((v) => v !== value)
  } else {
    selectedImpactPresets.value = [...current, value]
  }
}

const toggleAcmgClassification = (value: string): void => {
  const current = filters.value.acmgClassifications
  if (current.includes(value)) {
    filters.value.acmgClassifications = current.filter((v: string) => v !== value)
  } else {
    filters.value.acmgClassifications = [...current, value]
  }
}
</script>

<style scoped>
:deep(.v-expansion-panel-title) {
  min-height: 36px !important;
  padding: 8px 12px;
}

:deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 12px 12px;
}

.filter-section-header {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.preset-drawer-section {
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 95%, rgb(var(--v-theme-primary)));
}
</style>
