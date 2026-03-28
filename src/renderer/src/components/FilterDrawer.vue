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
          :icon="mdiMagnify"
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
            v-model="filters.searchQuery"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Gene, chr:pos, c./p. HGVS..."
            :prepend-inner-icon="mdiMagnify"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Preset chips (below Search, above remaining filters) -->
      <div
        v-if="visiblePresets && visiblePresets.length > 0"
        class="preset-drawer-section px-3 pt-2 pb-1"
      >
        <div class="d-flex align-center mb-1">
          <v-icon size="x-small" class="mr-1 text-medium-emphasis" :icon="mdiBookmarkMultiple" />
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
            <v-icon size="x-small" :icon="mdiCogOutline" />
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
          :icon="mdiDna"
          label="Gene"
          :active="isFilterGroupActive('gene')"
          :value-summary="geneSummary"
        />
        <v-expansion-panel-text>
          <v-autocomplete
            v-model="filters.geneSymbol"
            :items="geneSymbolSuggestions"
            :loading="loadingSuggestions"
            density="compact"
            variant="outlined"
            hide-details
            clearable
            placeholder="Search gene symbol (e.g. BRCA1)"
            aria-label="Filter by gene symbol"
            :prepend-inner-icon="mdiMagnify"
            @update:search="searchGeneSymbols"
            @click:clear="handleGeneClear"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Gene Panels -->
      <v-expansion-panel value="panels">
        <FilterPanelTitle
          :icon="mdiPlaylistEdit"
          label="Gene Panels"
          :active="isFilterGroupActive('panels')"
          :value-summary="panelsSummary"
        />
        <v-expansion-panel-text>
          <PanelFilterSection
            :active-panel-ids="filters.activePanelIds"
            :panel-padding-bp="filters.panelPaddingBp"
            :refresh-key="panelRefreshKey"
            @update:active-panel-ids="filters.activePanelIds = $event"
            @update:panel-padding-bp="filters.panelPaddingBp = $event"
            @open-manager="panelManagerOpen = true"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Impact -->
      <v-expansion-panel value="impact">
        <FilterPanelTitle
          :icon="mdiFlash"
          label="Impact"
          :active="isFilterGroupActive('impact')"
          :value-summary="impactSummary"
        />
        <v-expansion-panel-text>
          <div class="d-flex ga-1 flex-wrap mb-2">
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
            placeholder="Specific consequences..."
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Consequence (Function) -->
      <v-expansion-panel value="function">
        <FilterPanelTitle
          :icon="mdiFunction"
          label="Consequence"
          :active="isFilterGroupActive('function')"
          :value-summary="funcSummary"
        />
        <v-expansion-panel-text>
          <GroupedMultiSelect
            v-model="filters.funcs"
            :config="consequenceGroups"
            :available-values="filterOptions.funcs"
            label="Consequence"
            placeholder="Select..."
            :icon="mdiFunction"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- ClinVar -->
      <v-expansion-panel value="clinvar">
        <FilterPanelTitle
          :icon="mdiHospitalBox"
          label="ClinVar"
          :active="isFilterGroupActive('clinvar')"
          :value-summary="clinvarSummary"
        />
        <v-expansion-panel-text>
          <GroupedMultiSelect
            v-model="filters.clinvars"
            :config="clinvarGroups"
            :available-values="filterOptions.clinvars"
            label="ClinVar"
            placeholder="Select..."
            :icon="mdiHospitalBox"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- === POPULATION & SCORES === -->
      <div class="filter-section-header text-overline text-medium-emphasis px-3 pt-3 pb-1">
        <v-divider class="mb-2" />
        Population &amp; Scores
      </div>

      <!-- Frequency -->
      <v-expansion-panel value="frequency">
        <FilterPanelTitle
          :icon="mdiEarth"
          label="Frequency"
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
            v-model.number="filters.maxGnomadAf"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="0.0001"
            min="0"
            max="1"
            placeholder="Max AF (e.g. 0.01)"
            clearable
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- CADD -->
      <v-expansion-panel value="cadd">
        <FilterPanelTitle
          :icon="mdiAlertCircle"
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
            v-model.number="filters.minCadd"
            density="compact"
            variant="outlined"
            hide-details
            type="number"
            step="1"
            min="0"
            placeholder="Min CADD score"
            clearable
          />
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- === ANNOTATIONS === -->
      <div class="filter-section-header text-overline text-medium-emphasis px-3 pt-3 pb-1">
        <v-divider class="mb-2" />
        Annotations
      </div>

      <!-- Tags -->
      <v-expansion-panel value="tags">
        <FilterPanelTitle
          :icon="mdiTagMultiple"
          label="Tags"
          :active="isFilterGroupActive('tags')"
          :value-summary="tagsSummary"
        />
        <v-expansion-panel-text>
          <v-select
            v-model="filters.tagIds"
            :items="availableTags"
            item-title="name"
            item-value="id"
            density="compact"
            variant="outlined"
            hide-details
            multiple
            chips
            closable-chips
            placeholder="Filter by tags..."
          >
            <template #chip="{ item }">
              <v-chip
                closable
                size="small"
                :color="(item as unknown as Tag).color"
                variant="flat"
                @click:close="removeTagFilter((item as unknown as Tag).id)"
              >
                {{ (item as unknown as Tag).name }}
              </v-chip>
            </template>
            <template #item="{ item, props: itemProps }">
              <v-list-item v-bind="itemProps" :title="undefined">
                <template #prepend>
                  <v-icon :color="(item as unknown as Tag).color" size="small" :icon="mdiCircle" />
                </template>
                <v-list-item-title>{{ (item as unknown as Tag).name }}</v-list-item-title>
              </v-list-item>
            </template>
          </v-select>
        </v-expansion-panel-text>
      </v-expansion-panel>

      <!-- Annotations -->
      <v-expansion-panel value="annotations">
        <FilterPanelTitle
          :icon="mdiStarCircle"
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
              <v-icon size="small" start :icon="mdiStar" />
              Starred
            </v-btn>
            <v-btn
              :color="filters.hasCommentOnly ? 'primary' : undefined"
              :variant="filters.hasCommentOnly ? 'flat' : 'outlined'"
              size="small"
              rounded="pill"
              @click="filters.hasCommentOnly = !filters.hasCommentOnly"
            >
              <v-icon size="small" start :icon="mdiCommentText" />
              Commented
            </v-btn>
          </div>
          <div class="text-body-small text-medium-emphasis mb-1 mt-1">Annotation Scope</div>
          <AnnotationScopeToggle v-model="filters.annotationScope" class="mb-3" />
          <div class="text-body-small text-medium-emphasis mb-1">ACMG Classification</div>
          <div class="d-flex flex-wrap ga-1">
            <v-chip
              v-for="cls in acmgFilterOptions"
              :key="cls.value"
              :color="filters.acmgClassifications.includes(cls.value) ? cls.color : undefined"
              :variant="filters.acmgClassifications.includes(cls.value) ? 'flat' : 'outlined'"
              size="small"
              label
              @click="toggleAcmgFilter(cls.value)"
            >
              {{ cls.label }}
            </v-chip>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <PanelManagerDialog v-model="panelManagerOpen" @panels-changed="onPanelsChanged" />
  </FilterDrawerShell>
</template>

<script setup lang="ts">
import { inject, ref, computed } from 'vue'
import FilterDrawerShell from './filters/FilterDrawerShell.vue'
import FilterPanelTitle from './filters/FilterPanelTitle.vue'
import AnnotationScopeToggle from './AnnotationScopeToggle.vue'
import DslSearchBar from './DslSearchBar.vue'
import GroupedMultiSelect from './GroupedMultiSelect.vue'
import PanelManagerDialog from './panels/PanelManagerDialog.vue'
import PanelFilterSection from './panels/PanelFilterSection.vue'
import { consequenceGroups, clinvarGroups } from '../config/filterGroups'
import { ACMG_FILTER_OPTIONS_LONG } from '../utils/filters'
import type { Tag } from '../../../shared/types/api'
import type { FilterDrawerState } from './filterDrawerTypes'
import {
  mdiAlertCircle,
  mdiBookmarkMultiple,
  mdiCircle,
  mdiCogOutline,
  mdiCommentText,
  mdiDna,
  mdiEarth,
  mdiFlash,
  mdiFunction,
  mdiHospitalBox,
  mdiMagnify,
  mdiPlaylistEdit,
  mdiStar,
  mdiStarCircle,
  mdiTagMultiple
} from '@mdi/js'

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
  'panels',
  'impact',
  'function',
  'clinvar',
  'frequency',
  'cadd',
  'tags',
  'annotations'
]
const expandedPanels = ref<string[]>(['search', 'impact', 'frequency'])

// Gene panel manager dialog state
const panelManagerOpen = ref(false)
const panelRefreshKey = ref(0)

function onPanelsChanged(): void {
  panelRefreshKey.value++
}

// Inject shared filter state from FilterToolbar
const state = inject<FilterDrawerState>('filterDrawerState')

if (!state) {
  throw new Error('FilterDrawer must be rendered inside FilterToolbar (missing filterDrawerState)')
}

// Destructure for template convenience
const {
  filters,
  filterOptions,
  geneSymbolSuggestions,
  loadingSuggestions,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
  afPresets,
  caddPresets,
  impactPresets,
  availableTags,
  activeFilterCount,
  isFilterGroupActive,
  clearAllFilters,
  handleGeneClear,
  searchGeneSymbols,
  removeTagFilter,
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
const searchSummary = computed(() => filters.value.searchQuery || '')
const geneSummary = computed(() => filters.value.geneSymbol || '')

const impactSummary = computed(() => {
  if (selectedImpactPresets.value.length > 0) {
    return selectedImpactPresets.value.join(', ')
  }
  if (filters.value.consequences.length > 0) {
    return `${filters.value.consequences.length} selected`
  }
  return ''
})

const funcSummary = computed(() =>
  filters.value.funcs.length > 0 ? `${filters.value.funcs.length} selected` : ''
)

const clinvarSummary = computed(() =>
  filters.value.clinvars.length > 0 ? `${filters.value.clinvars.length} selected` : ''
)

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

const tagsSummary = computed(() =>
  filters.value.tagIds.length > 0 ? `${filters.value.tagIds.length} tags` : ''
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

const panelsSummary = computed(() =>
  filters.value.activePanelIds.length > 0 ? `${filters.value.activePanelIds.length} panel(s)` : ''
)

const acmgFilterOptions = ACMG_FILTER_OPTIONS_LONG

const toggleImpactPreset = (value: string): void => {
  const current = selectedImpactPresets.value
  if (current.includes(value)) {
    selectedImpactPresets.value = current.filter((v) => v !== value)
  } else {
    selectedImpactPresets.value = [...current, value]
  }
}

const toggleAcmgFilter = (value: string): void => {
  const current = filters.value.acmgClassifications
  if (current.includes(value)) {
    filters.value.acmgClassifications = current.filter((v) => v !== value)
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
