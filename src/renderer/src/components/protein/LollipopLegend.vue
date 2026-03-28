<template>
  <div class="lollipop-legend pa-2 bg-grey-lighten-4">
    <!-- gnomAD Variants filter row -->
    <div class="d-flex flex-wrap ga-1 align-center mb-2">
      <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium section-label"
        >gnomAD Variants:</span
      >
      <div
        v-for="[category, color] in consequenceEntries"
        :key="category"
        class="filter-pill"
        :class="{ inactive: !isActive(category) }"
      >
        <v-chip
          size="small"
          label
          :variant="isActive(category) ? 'flat' : 'outlined'"
          :style="chipStyle(category, color)"
          class="cursor-pointer"
          @click="toggle(category)"
        >
          {{ formatCategory(category) }}
          ({{ consequenceCounts[category] ?? 0 }})
        </v-chip>
        <v-btn
          size="x-small"
          variant="text"
          class="only-btn text-none"
          @click.stop="emit('select-only-category', category)"
        >
          only
        </v-btn>
      </div>
      <v-chip
        size="small"
        label
        variant="outlined"
        color="grey-darken-1"
        class="ml-2"
        @click="emit('select-all-categories')"
      >
        All
      </v-chip>
    </div>

    <!-- ClinVar Significance filter row -->
    <div v-if="hasClinvar" class="d-flex flex-wrap ga-1 align-center mb-2">
      <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium section-label"
        >ClinVar Significance:</span
      >
      <div
        v-for="[category, color] in clinvarEntries"
        :key="category"
        class="filter-pill"
        :class="{ inactive: !isClinVarActive(category) }"
      >
        <v-chip
          size="small"
          label
          :variant="isClinVarActive(category) ? 'flat' : 'outlined'"
          :style="clinvarChipStyle(category, color)"
          class="cursor-pointer"
          @click="toggleClinVar(category)"
        >
          {{ formatClinVarCategory(category) }}
          ({{ clinvarCounts[category] ?? 0 }})
        </v-chip>
        <v-btn
          size="x-small"
          variant="text"
          class="only-btn text-none"
          @click.stop="emit('select-only-clinvar', category)"
        >
          only
        </v-btn>
      </div>
      <v-chip
        size="small"
        label
        variant="outlined"
        color="grey-darken-1"
        class="ml-2"
        @click="emit('select-all-clinvar')"
      >
        All
      </v-chip>
    </div>

    <!-- ClinVar Consequence filter row -->
    <div v-if="hasClinvar" class="d-flex flex-wrap ga-1 align-center mb-2">
      <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium section-label"
        >ClinVar Consequence:</span
      >
      <div
        v-for="[category, color] in consequenceEntries"
        :key="'cv-cons-' + category"
        class="filter-pill"
        :class="{ inactive: !isClinVarConsequenceActive(category) }"
      >
        <v-chip
          size="small"
          label
          :variant="isClinVarConsequenceActive(category) ? 'flat' : 'outlined'"
          :style="clinvarConsequenceChipStyle(category, color)"
          class="cursor-pointer"
          @click="toggleClinVarConsequence(category)"
        >
          {{ formatCategory(category) }}
          ({{ clinvarConsequenceCounts[category] ?? 0 }})
        </v-chip>
        <v-btn
          size="x-small"
          variant="text"
          class="only-btn text-none"
          @click.stop="emit('select-only-clinvar-consequence', category)"
        >
          only
        </v-btn>
      </div>
      <v-chip
        size="small"
        label
        variant="outlined"
        color="grey-darken-1"
        class="ml-2"
        @click="emit('select-all-clinvar-consequences')"
      >
        All
      </v-chip>
    </div>

    <!-- Domain color indicators -->
    <div v-if="domainTypes.length > 0" class="d-flex flex-wrap ga-1 align-center mb-2">
      <span class="text-body-2 text-medium-emphasis mr-1 font-weight-medium section-label"
        >Domains:</span
      >
      <span
        v-for="[type, color] in domainTypes"
        :key="type"
        class="d-inline-flex align-center ga-1 text-body-2"
      >
        <span class="domain-swatch" :style="{ backgroundColor: color }" />
        {{ type }}
      </span>
    </div>

    <!-- Track legend -->
    <div
      class="d-flex align-center flex-wrap ga-3 pt-1"
      style="border-top: 1px solid rgba(0, 0, 0, 0.08)"
    >
      <span class="text-body-2 text-medium-emphasis font-weight-medium">Tracks:</span>
      <span class="d-inline-flex align-center ga-1">
        <span
          style="
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: #008000;
            border: 2px solid #ffd700;
            display: inline-block;
          "
        />
        <span class="text-body-2">Your variant</span>
      </span>
      <span class="d-inline-flex align-center ga-1">
        <span
          style="
            width: 8px;
            height: 8px;
            transform: rotate(45deg);
            background: #d73027;
            display: inline-block;
          "
        />
        <span class="text-body-2">ClinVar</span>
      </span>
      <span class="d-inline-flex align-center ga-1">
        <span
          style="
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #008000;
            opacity: 0.5;
            display: inline-block;
          "
        />
        <span class="text-body-2">gnomAD</span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type {
  ConsequenceCategory,
  ClinVarSignificance,
  ProteinDomain
} from '../../../../shared/types/protein'
import {
  CONSEQUENCE_COLORS,
  CLINVAR_COLORS,
  DOMAIN_TYPE_COLORS
} from '../../../../shared/utils/protein-utils'

interface Props {
  activeCategories: Set<ConsequenceCategory>
  activeClinvarCategories: Set<ClinVarSignificance>
  activeClinvarConsequences: Set<ConsequenceCategory>
  domains: ProteinDomain[]
  /** Whether ClinVar data is available */
  hasClinvar: boolean
  /** Variant counts per consequence category (gnomAD) */
  consequenceCounts: Record<ConsequenceCategory, number>
  /** Variant counts per ClinVar significance category */
  clinvarCounts: Record<ClinVarSignificance, number>
  /** Variant counts per consequence category (ClinVar) */
  clinvarConsequenceCounts: Record<ConsequenceCategory, number>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-category': [category: ConsequenceCategory]
  'select-only-category': [category: ConsequenceCategory]
  'select-all-categories': []
  'toggle-clinvar-category': [category: ClinVarSignificance]
  'select-only-clinvar': [category: ClinVarSignificance]
  'select-all-clinvar': []
  'toggle-clinvar-consequence': [category: ConsequenceCategory]
  'select-only-clinvar-consequence': [category: ConsequenceCategory]
  'select-all-clinvar-consequences': []
}>()

const consequenceEntries = computed(
  () => Object.entries(CONSEQUENCE_COLORS) as [ConsequenceCategory, string][]
)

const clinvarEntries = computed(
  () => Object.entries(CLINVAR_COLORS) as [ClinVarSignificance, string][]
)

/** Unique domain types present in the current protein */
const domainTypes = computed(() => {
  const seen = new Set<string>()
  const result: [string, string][] = []
  for (const domain of props.domains) {
    const key = domain.type.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push([domain.type, DOMAIN_TYPE_COLORS[key] ?? '#9E9E9E'])
    }
  }
  return result
})

function isActive(category: ConsequenceCategory): boolean {
  return props.activeCategories.has(category)
}

function toggle(category: ConsequenceCategory): void {
  emit('toggle-category', category)
}

function formatCategory(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function chipStyle(category: ConsequenceCategory, color: string): Record<string, string> {
  if (isActive(category)) {
    return { backgroundColor: color, color: '#fff', borderColor: color }
  }
  return { borderColor: color, color, opacity: '0.6' }
}

function isClinVarActive(category: ClinVarSignificance): boolean {
  return props.activeClinvarCategories.has(category)
}

function toggleClinVar(category: ClinVarSignificance): void {
  emit('toggle-clinvar-category', category)
}

const CLINVAR_LABELS: Record<ClinVarSignificance, string> = {
  pathogenic: 'Pathogenic',
  likely_pathogenic: 'Likely P.',
  uncertain: 'VUS',
  likely_benign: 'Likely B.',
  benign: 'Benign',
  other: 'Other'
}

function formatClinVarCategory(category: ClinVarSignificance): string {
  return CLINVAR_LABELS[category]
}

function isClinVarConsequenceActive(category: ConsequenceCategory): boolean {
  return props.activeClinvarConsequences.has(category)
}

function toggleClinVarConsequence(category: ConsequenceCategory): void {
  emit('toggle-clinvar-consequence', category)
}

function clinvarConsequenceChipStyle(
  category: ConsequenceCategory,
  color: string
): Record<string, string> {
  if (isClinVarConsequenceActive(category)) {
    return { backgroundColor: color, color: '#fff', borderColor: color }
  }
  return { borderColor: color, color, opacity: '0.6' }
}

function clinvarChipStyle(category: ClinVarSignificance, color: string): Record<string, string> {
  if (isClinVarActive(category)) {
    // For light colors (uncertain/yellow), use dark text
    const textColor = category === 'uncertain' ? '#333' : '#fff'
    return { backgroundColor: color, color: textColor, borderColor: color }
  }
  return { borderColor: color, color, opacity: '0.6' }
}
</script>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.domain-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.filter-pill.inactive {
  opacity: 0.5;
}

.only-btn {
  font-size: 10px;
  min-width: 32px;
  height: 20px;
  padding: 0 4px;
  text-transform: lowercase;
  opacity: 0.6;
}

.only-btn:hover {
  opacity: 1;
}

.section-label {
  min-width: 140px;
}
</style>
