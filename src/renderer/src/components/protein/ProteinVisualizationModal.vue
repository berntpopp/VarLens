<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    transition="dialog-bottom-transition"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card class="d-flex flex-column fill-height">
      <!-- Header -->
      <v-toolbar color="secondary" density="comfortable" flat>
        <v-btn icon variant="text" @click="emit('update:modelValue', false)">
          <v-icon :icon="mdiClose" />
        </v-btn>

        <v-toolbar-title class="d-flex align-center ga-3">
          <!-- Gene selector -->
          <v-select
            v-model="selectedGene"
            :items="geneOptions"
            density="compact"
            variant="outlined"
            hide-details
            style="max-width: 200px"
            label="Gene"
          />

          <!-- Protein name -->
          <span v-if="proteinData.mapping.value" class="text-body-1">
            {{ proteinData.mapping.value.proteinName }}
          </span>
          <span v-if="proteinData.proteinLength.value > 0" class="text-body-2 text-medium-emphasis">
            {{ proteinData.proteinLength.value }} aa
          </span>
        </v-toolbar-title>

        <template #append>
          <!-- Tabs -->
          <v-tabs v-model="activeTab" color="white" density="compact">
            <v-tab value="lollipop">Lollipop Plot</v-tab>
            <v-tab value="3d">3D Structure</v-tab>
          </v-tabs>
        </template>
      </v-toolbar>

      <!-- Loading state -->
      <v-progress-linear v-if="proteinData.loading.value" indeterminate color="primary" />

      <!-- Content area -->
      <div class="flex-grow-1" style="min-height: 0">
        <!-- Error state -->
        <div
          v-if="proteinData.error.value"
          class="d-flex flex-column align-center justify-center fill-height pa-8"
        >
          <v-icon size="64" color="error" :icon="mdiAlertCircleOutline" class="mb-4" />
          <div class="text-h6 mb-2">Failed to Load Protein Data</div>
          <div class="text-body-2 text-medium-emphasis mb-4">
            {{ proteinData.error.value }}
          </div>
          <v-btn variant="outlined" color="primary" @click="proteinData.refetch()"> Retry </v-btn>
        </div>

        <!-- Empty / loading skeleton -->
        <div
          v-else-if="proteinData.loading.value"
          class="d-flex flex-column align-center justify-center fill-height pa-8"
        >
          <v-skeleton-loader type="card" class="w-100" style="max-width: 800px" />
        </div>

        <!-- No protein data available -->
        <div
          v-else-if="!proteinData.mapping.value"
          class="d-flex flex-column align-center justify-center fill-height pa-8"
        >
          <v-icon size="64" color="grey" :icon="mdiDna" class="mb-4" />
          <div class="text-h6 mb-2">No Protein Data</div>
          <div class="text-body-2 text-medium-emphasis">
            Could not find UniProt mapping for {{ selectedGene ?? 'this gene' }}.
          </div>
        </div>

        <!-- Lollipop Plot tab -->
        <LollipopPlotPanel
          v-else-if="activeTab === 'lollipop'"
          :protein-length="proteinData.proteinLength.value"
          :domains="proteinData.domains.value"
          :variants="lollipopVariants"
          :gene-symbol="selectedGene"
          class="fill-height"
        />

        <!-- 3D Structure tab -->
        <ProteinStructure3DPanel
          v-else-if="activeTab === '3d'"
          :structure-info="proteinData.structureInfo.value"
          :variants="lollipopVariants"
          class="fill-height"
        />
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { mdiClose, mdiAlertCircleOutline, mdiDna } from '@mdi/js'
import { useProteinData } from '../../composables/useProteinData'
import LollipopPlotPanel from './LollipopPlotPanel.vue'
import ProteinStructure3DPanel from './ProteinStructure3DPanel.vue'
import type { Variant } from '../../../../shared/types/api'
import type { CohortVariant } from '../../../../shared/types/cohort'
import type { LollipopVariant } from '../../../../shared/types/protein'
import {
  parseProteinPosition,
  getConsequenceCategory,
  getConsequenceColor
} from '../../../../shared/utils/protein-utils'

interface Props {
  modelValue: boolean
  initialGene: string | null
  allVariants: (Variant | CohortVariant)[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const activeTab = ref('lollipop')
const selectedGene = ref<string | null>(props.initialGene)

// Update selected gene when initialGene changes
watch(
  () => props.initialGene,
  (newGene) => {
    if (newGene !== null && newGene !== '') {
      selectedGene.value = newGene
    }
  }
)

// Compute unique gene options from all variants
const geneOptions = computed<string[]>(() => {
  const genes = new Set<string>()
  for (const v of props.allVariants) {
    if (v.gene_symbol !== null && v.gene_symbol !== '') {
      genes.add(v.gene_symbol)
    }
  }
  return Array.from(genes).sort()
})

// Protein data composable
const proteinData = useProteinData(selectedGene)

// Convert variants to LollipopVariant format
const lollipopVariants = computed<LollipopVariant[]>(() => {
  const result: LollipopVariant[] = []
  for (const v of props.allVariants) {
    if (v.gene_symbol !== selectedGene.value) continue

    const proteinPosition = parseProteinPosition(v.aa_change)
    if (proteinPosition === null) continue

    const consequence = v.consequence ?? 'unknown'
    const consequenceCategory = getConsequenceCategory(consequence)
    const color = getConsequenceColor(consequence)

    const cadd = 'cadd' in v ? (v.cadd ?? null) : 'cadd_phred' in v ? (v.cadd_phred ?? null) : null

    result.push({
      proteinPosition,
      aaChange: v.aa_change,
      consequence,
      consequenceCategory,
      color,
      geneSymbol: v.gene_symbol ?? '',
      chr: v.chr,
      pos: v.pos,
      ref: v.ref,
      alt: v.alt,
      gnomadAf: v.gnomad_af ?? null,
      cadd,
      clinvar: v.clinvar ?? null
    })
  }
  return result
})
</script>
