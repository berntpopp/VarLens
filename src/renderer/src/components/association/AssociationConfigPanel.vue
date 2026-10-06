<template>
  <v-card variant="outlined" class="mb-3">
    <v-card-title class="d-flex align-center">
      <span class="text-h6">Gene Burden Analysis</span>
      <v-spacer />
      <v-btn
        v-if="hasResults"
        :aria-label="collapsed ? 'Expand configuration' : 'Collapse configuration'"
        variant="text"
        size="small"
        :icon="collapsed ? mdiChevronDown : mdiChevronUp"
        @click="collapsed = !collapsed"
      />
    </v-card-title>

    <v-card-text v-show="!collapsed">
      <!-- Group builders side by side -->
      <v-row>
        <v-col cols="6">
          <GroupBuilder
            v-model="groupAIds"
            label="Group A (Cases)"
            :all-cases="allCases"
            :cohort-groups="cohortGroups"
          />
        </v-col>
        <v-col cols="6">
          <GroupBuilder
            v-model="groupBIds"
            label="Group B (Controls)"
            :all-cases="allCases"
            :cohort-groups="cohortGroups"
          />
        </v-col>
      </v-row>

      <!-- Overlap warning -->
      <v-alert v-if="overlapCount > 0" type="error" variant="tonal" density="compact" class="mb-2">
        {{ overlapCount }} case(s) appear in both groups. Remove duplicates before running.
      </v-alert>

      <!-- Variant filters -->
      <v-expansion-panels variant="accordion" class="mb-2">
        <v-expansion-panel title="Variant Filters" eager>
          <v-expansion-panel-text eager>
            <!-- Impact preset chips -->
            <div class="d-flex align-center mb-3">
              <span class="text-body-2 text-medium-emphasis mr-2">Impact:</span>
              <v-chip-group v-model="selectedImpactPresets" multiple>
                <v-chip
                  v-for="preset in impactPresets"
                  :key="preset.value"
                  :color="preset.color"
                  variant="outlined"
                  filter
                  size="small"
                >
                  {{ preset.label }}
                </v-chip>
              </v-chip-group>
            </div>

            <v-row dense>
              <!-- gnomAD AF with presets -->
              <v-col cols="4">
                <div class="d-flex align-center mb-1">
                  <span class="text-body-2 text-medium-emphasis mr-2">Max gnomAD AF:</span>
                  <v-chip-group v-model="selectedAfPreset" class="flex-grow-0">
                    <v-chip
                      v-for="preset in afPresets"
                      :key="preset.value"
                      size="x-small"
                      variant="outlined"
                      filter
                    >
                      {{ preset.label }}
                    </v-chip>
                  </v-chip-group>
                </div>
                <v-text-field
                  :model-value="filters.maxGnomadAf"
                  type="number"
                  :min="0"
                  :max="1"
                  :step="0.001"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                  placeholder="e.g. 0.01"
                  @update:model-value="onMaxGnomadAfInput"
                />
              </v-col>

              <!-- CADD with presets -->
              <v-col cols="4">
                <div class="d-flex align-center mb-1">
                  <span class="text-body-2 text-medium-emphasis mr-2">Min CADD:</span>
                  <v-chip-group v-model="selectedCaddPreset" class="flex-grow-0">
                    <v-chip
                      v-for="preset in caddPresets"
                      :key="preset.value"
                      size="x-small"
                      variant="outlined"
                      filter
                    >
                      {{ preset.label }}
                    </v-chip>
                  </v-chip-group>
                </div>
                <v-text-field
                  :model-value="filters.minCadd"
                  type="number"
                  :min="0"
                  :max="60"
                  density="compact"
                  variant="outlined"
                  hide-details
                  clearable
                  placeholder="e.g. 20"
                  @update:model-value="onMinCaddInput"
                />
              </v-col>

              <!-- Consequences with GroupedMultiSelect -->
              <v-col cols="4">
                <div class="mb-1">
                  <span class="text-body-2 text-medium-emphasis">Consequences:</span>
                </div>
                <GroupedMultiSelect
                  v-model:model-value="filters.consequences"
                  :config="consequenceGroupConfig"
                  label="Consequences"
                  :icon="mdiFilterVariant"
                />
              </v-col>
            </v-row>

            <!-- Gene list input -->
            <v-row dense class="mt-2">
              <v-col cols="12">
                <v-textarea
                  v-model="geneListText"
                  label="Gene list (optional)"
                  placeholder="Paste gene symbols, one per line or comma-separated (e.g. BRCA1, TP53, EGFR)"
                  density="compact"
                  variant="outlined"
                  hide-details
                  rows="2"
                  auto-grow
                >
                  <template #prepend-inner>
                    <v-icon size="small" class="mr-1" :icon="mdiDna" />
                  </template>
                  <template #append-inner>
                    <v-chip v-if="parsedGeneList.length > 0" size="x-small" color="primary">
                      {{ parsedGeneList.length }} genes
                    </v-chip>
                  </template>
                </v-textarea>
              </v-col>
            </v-row>

            <!-- Extension column filters (Task 13 — cohort parity for Path 3) -->
            <div class="mt-3">
              <FilterTypeNarrowingChip
                :column-filters="filters.columnFilters"
                @clear-filter="handleClearTypeFilter"
              />
              <ExtensionColumnFilters
                v-if="scopeCaseIds.length > 0"
                :scope="{ caseIds: scopeCaseIds }"
                :model-value="filters.columnFilters"
                @update:model-value="onColumnFiltersUpdate"
              />
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <!-- Analysis settings -->
      <v-row dense class="mb-2">
        <v-col cols="4">
          <v-radio-group
            v-model="primaryTest"
            label="Primary test"
            density="compact"
            hide-details
            inline
          >
            <v-radio label="Fisher's exact" value="fisher" />
            <v-radio label="Logistic burden" value="logistic_burden" />
          </v-radio-group>
        </v-col>
        <v-col cols="4">
          <v-select
            v-model="weightScheme"
            label="Weight scheme"
            :items="weightOptions"
            item-title="label"
            item-value="value"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-col>
        <v-col cols="4">
          <v-select
            v-model="selectedCovariates"
            label="Covariates"
            :items="covariateOptions"
            multiple
            chips
            density="compact"
            variant="outlined"
            hide-details
            closable-chips
          />
        </v-col>
      </v-row>
    </v-card-text>

    <v-card-actions v-show="!collapsed">
      <v-chip v-if="groupAIds.length > 0" size="small" color="primary" variant="tonal">
        Group A: {{ groupAIds.length }}
      </v-chip>
      <v-chip
        v-if="groupBIds.length > 0"
        size="small"
        color="secondary"
        variant="tonal"
        class="ml-1"
      >
        Group B: {{ groupBIds.length }}
      </v-chip>
      <v-spacer />
      <v-btn
        color="primary"
        variant="elevated"
        :disabled="!canRun"
        :loading="running"
        :prepend-icon="mdiPlay"
        @click="handleRun"
      >
        Run Analysis
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import GroupBuilder from './GroupBuilder.vue'
import GroupedMultiSelect from '../GroupedMultiSelect.vue'
import ExtensionColumnFilters from '../filters/ExtensionColumnFilters.vue'
import FilterTypeNarrowingChip from '../filters/FilterTypeNarrowingChip.vue'
import { createFilters } from '../../composables/useFilters'
import { buildIpcParams } from '../../utils/filters'
import { consequenceGroups, getGroupValues } from '../../config/filterGroups'
import { mdiChevronDown, mdiChevronUp, mdiDna, mdiFilterVariant, mdiPlay } from '@mdi/js'
import type { FilterIpcParams } from '../../../../shared/types/filters'
import type { ColumnFiltersParam } from '../../../../shared/types/column-filters'

interface CaseInfo {
  id: number
  name: string
  status: string | null
  sex: string | null
  cohortIds: number[]
}

interface CohortGroup {
  id: number
  name: string
}

defineProps<{
  allCases: CaseInfo[]
  cohortGroups: CohortGroup[]
  running?: boolean
  hasResults?: boolean
}>()

/**
 * Burden-analysis config emitted on Run.
 *
 * `filters` is the shared FilterIpcParams shape (same contract as Paths 1/2)
 * with a panel-specific `gene_list` field merged in — the shared FilterState
 * only has a single `geneSymbol` substring, so the textarea-parsed gene list
 * is attached to the IPC payload inside handleRun() instead of living on the
 * FilterState type.
 */
const emit = defineEmits<{
  run: [
    config: {
      groupA_ids: number[]
      groupB_ids: number[]
      primary_test: string
      weight_scheme: string
      covariates: string[]
      filters: FilterIpcParams & { gene_list?: string[] }
      max_threads: number
    }
  ]
}>()

// Panel-local shared FilterState instance (NOT the case-view instance).
// createFilters() builds a fresh FilterState with its own maxGnomadAf/minCadd/
// consequences/columnFilters refs; useFilters() is the inject-based consumer
// variant and would throw here because this panel has no provider.
//
// We expose `filters` for the template + watchers, and use the panel's own
// index-based preset chip refs (below) rather than the composable's
// value-based preset refs because v-chip-group binds by index.
const { filters } = createFilters()

const collapsed = ref(false)
const groupAIds = ref<number[]>([])
const groupBIds = ref<number[]>([])
const primaryTest = ref('fisher')
const weightScheme = ref('uniform')
const selectedCovariates = ref<string[]>([])
const geneListText = ref('')

// Impact presets (panel-specific UX — maps HIGH/MOD/LOW chips to the SO
// consequence arrays that live on the shared filters.value.consequences field).
const impactPresets = [
  { label: 'HIGH', value: 'HIGH', color: 'error' },
  { label: 'MOD', value: 'MODERATE', color: 'warning' },
  { label: 'LOW', value: 'LOW', color: 'info' }
]

// Map impact levels to consequence groups
const impactToConsequences: Record<string, string[]> = {
  HIGH: [...getGroupValues(consequenceGroups, 'truncating')],
  MODERATE: [
    ...getGroupValues(consequenceGroups, 'missense_inframe'),
    ...getGroupValues(consequenceGroups, 'splice_region')
  ],
  LOW: [...getGroupValues(consequenceGroups, 'synonymous')]
}

const selectedImpactPresets = ref<number[]>([])

// Impact preset chips → shared filters.consequences.
// Rebuild the preset-derived portion from the currently-selected chips on
// every change: we strip every consequence that belongs to ANY impact
// preset, then add back consequences for the currently-selected presets.
// This preserves manual consequence selections (from GroupedMultiSelect)
// that don't overlap any preset, while correctly handling deselection —
// clicking HIGH off after HIGH+MOD now leaves only MOD consequences in
// place, and deselecting all chips removes all preset-derived consequences.
const allPresetConsequences = (() => {
  const set = new Set<string>()
  for (const preset of impactPresets) {
    for (const v of impactToConsequences[preset.value] ?? []) set.add(v)
  }
  return set
})()
watch(selectedImpactPresets, (indices) => {
  // Start from current consequences minus anything that belongs to a preset
  // (preserves non-preset manual selections)
  const next = new Set<string>(
    filters.value.consequences.filter((c) => !allPresetConsequences.has(c))
  )
  // Add back consequences for currently-selected presets
  for (const idx of indices) {
    const preset = impactPresets[idx]
    for (const v of impactToConsequences[preset.value] ?? []) next.add(v)
  }
  filters.value.consequences = [...next]
})

// gnomAD AF presets
const afPresets = [
  { label: '1%', value: 0.01 },
  { label: '0.1%', value: 0.001 },
  { label: '0.01%', value: 0.0001 }
]

const selectedAfPreset = ref<number | undefined>(undefined)

// AF preset chip → shared filters.maxGnomadAf.
// Deselecting a chip clears the filter (null) so presets behave as a
// single-select mode switch. Users who want to keep a manual value
// should not toggle a preset chip afterwards.
watch(selectedAfPreset, (idx) => {
  if (idx !== undefined && idx >= 0 && idx < afPresets.length) {
    filters.value.maxGnomadAf = afPresets[idx].value
  } else {
    filters.value.maxGnomadAf = null
  }
})

// CADD presets
const caddPresets = [
  { label: '15', value: 15 },
  { label: '20', value: 20 },
  { label: '25', value: 25 }
]

const selectedCaddPreset = ref<number | undefined>(undefined)

// CADD preset chip → shared filters.minCadd.
// Same deselect-clears semantic as the AF preset watcher above.
watch(selectedCaddPreset, (idx) => {
  if (idx !== undefined && idx >= 0 && idx < caddPresets.length) {
    filters.value.minCadd = caddPresets[idx].value
  } else {
    filters.value.minCadd = null
  }
})

// Consequence group config
const consequenceGroupConfig = consequenceGroups

const weightOptions = [
  { label: 'Uniform (equal)', value: 'uniform' },
  { label: 'Beta(MAF; 1, 25)', value: 'beta_maf' },
  { label: 'Beta(MAF) x CADD', value: 'beta_maf_cadd' }
]

const covariateOptions = ['sex', 'age']

// Parse gene list from textarea — stays panel-local because the shared
// FilterState has a single `geneSymbol` substring field, not a list.
const parsedGeneList = computed(() => {
  if (!geneListText.value.trim()) return []
  return geneListText.value
    .split(/[\n,;]+/)
    .map((g) => g.trim().toUpperCase())
    .filter((g) => g.length > 0)
})

const overlapCount = computed(() => {
  const setA = new Set(groupAIds.value)
  return groupBIds.value.filter((id) => setA.has(id)).length
})

const canRun = computed(
  () => groupAIds.value.length > 0 && groupBIds.value.length > 0 && overlapCount.value === 0
)

// Scope for ExtensionColumnFilters — the metadata scope covers the union of
// both groups so SV/CNV/STR presence is computed against all analysed cases.
// When both groups are empty we don't mount the extension filters at all to
// avoid an IPC call with an empty caseIds array.
const scopeCaseIds = computed<number[]>(() => [
  ...new Set<number>([...groupAIds.value, ...groupBIds.value])
])

/**
 * Handle numeric input for `filters.maxGnomadAf`. The shared FilterState
 * stores this as `number | null` (null = "not set"); the v-text-field emits
 * string | null from `@update:model-value`, so we coerce to a number when
 * it's a valid non-empty string and otherwise clear to null.
 */
function onMaxGnomadAfInput(value: string | number | null | undefined): void {
  if (value === null || value === undefined || value === '') {
    filters.value.maxGnomadAf = null
    return
  }
  const num = typeof value === 'number' ? value : Number(value)
  filters.value.maxGnomadAf = Number.isNaN(num) ? null : num
}

function onMinCaddInput(value: string | number | null | undefined): void {
  if (value === null || value === undefined || value === '') {
    filters.value.minCadd = null
    return
  }
  const num = typeof value === 'number' ? value : Number(value)
  filters.value.minCadd = Number.isNaN(num) ? null : num
}

/**
 * Extension column filters update — assign the new dictionary to the shared
 * FilterState so the narrowing chip + buildIpcParams pick it up on next run.
 */
function onColumnFiltersUpdate(value: ColumnFiltersParam): void {
  filters.value.columnFilters = value
}

/**
 * Strip every key matching `${typeKey}.*` from filters.columnFilters when the
 * narrowing chip fires a type-level clear (e.g. "clear all SV filters").
 */
function handleClearTypeFilter(typeKey: string): void {
  const next: ColumnFiltersParam = { ...filters.value.columnFilters }
  for (const key of Object.keys(next)) {
    if (key.startsWith(`${typeKey}.`)) {
      delete next[key]
    }
  }
  filters.value.columnFilters = next
}

function handleRun(): void {
  // buildIpcParams serializes FilterState → FilterIpcParams (camelCase →
  // snake_case, drops empty/null values, clones arrays for IPC transport).
  // It covers gnomad_af_max, cadd_min, consequences, column_filters, etc.
  const ipcFilters: FilterIpcParams & { gene_list?: string[] } = buildIpcParams(filters.value)

  // gene_list is panel-local (see parsedGeneList); merge it into the IPC
  // payload here because it's not part of the shared FilterState contract.
  if (parsedGeneList.value.length > 0) {
    ipcFilters.gene_list = [...parsedGeneList.value]
  }

  emit('run', {
    groupA_ids: [...groupAIds.value],
    groupB_ids: [...groupBIds.value],
    primary_test: primaryTest.value,
    weight_scheme: weightScheme.value,
    covariates: [...selectedCovariates.value],
    filters: ipcFilters,
    max_threads: 4
  })
}

// Expose internals for tests (see tests/renderer/components/association/*).
//
// WARNING for future test authors: writing directly to `filters.value.*`
// (e.g. `wrapper.vm.filters.maxGnomadAf = 0.05`) bypasses the panel's input
// sanitization handlers (`onMaxGnomadAfInput`, `onMaxCaddInput`, etc.) that
// normalize empty strings, clamp ranges, and reconcile mutually exclusive
// preset chips. For user-flow-like tests, prefer driving the actual
// `v-text-field` inputs (`wrapper.find('input[aria-label="..."]').setValue(...)`)
// or invoking the corresponding `on*Input` handlers directly. Bypassing the
// handlers can leave `filters` in a state the user cannot actually reach
// through the UI, masking bugs and producing false-positive green tests.
defineExpose({
  groupAIds,
  groupBIds,
  filters,
  selectedImpactPresets,
  selectedAfPreset,
  selectedCaddPreset,
  geneListText,
  handleRun,
  handleClearTypeFilter,
  onColumnFiltersUpdate,
  scopeCaseIds
})
</script>
