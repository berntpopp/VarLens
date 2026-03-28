<script setup lang="ts">
/**
 * ProteinStructure3DPanel - Assembly component for 3D protein structure viewer
 * Combines StructureControls, MolstarViewer, and a variant sidebar
 */

import { computed, ref } from 'vue'
import { mdiTargetVariant, mdiMedicalBag, mdiFilter } from '@mdi/js'
import type {
  LollipopVariant,
  ClinVarVariant,
  ProteinStructureInfo
} from '../../../../shared/types/protein'
import {
  getConsequenceColor,
  getClinVarCategory,
  CLINVAR_COLORS
} from '../../../../shared/utils/protein-utils'
import MolstarViewer from './MolstarViewer.vue'
import StructureControls from './StructureControls.vue'
import type { RepresentationType, VariantStyle } from '../../composables/useMolstarViewer'

/** Filter state for sidebar variant visibility */
const showUserVariants = ref(true)
const showClinvarVariants = ref(true)
const clinvarFilter = ref<'all' | 'pathogenic' | 'likely_pathogenic'>('all')
const variantStyle = ref<VariantStyle>('colored')

const props = defineProps<{
  structureInfo: ProteinStructureInfo | null
  variants: LollipopVariant[]
  clinvarVariants?: ClinVarVariant[]
}>()

const molstarViewerRef = ref<InstanceType<typeof MolstarViewer> | null>(null)

/** Active structure source */
const activeSource = computed(() => {
  if (props.structureInfo === null) return null
  return props.structureInfo.alphafold ?? props.structureInfo.pdb ?? null
})

const isAlphaFold = computed(() => activeSource.value?.source === 'alphafold')

const sourceLabel = computed(() => {
  if (activeSource.value === null || activeSource.value === undefined) return ''
  return activeSource.value.source === 'alphafold'
    ? `AlphaFold ${activeSource.value.version !== undefined ? `v${activeSource.value.version}` : ''}`
    : `PDB: ${activeSource.value.id}`
})

/** Filter to only missense variants for the sidebar */
const missenseVariants = computed(() =>
  props.variants.filter((v) => v.consequenceCategory === 'missense' && v.proteinPosition > 0)
)

/** Filter ClinVar to P/LP variants with protein positions for the sidebar */
const pathogenicClinvarVariants = computed(() => {
  const cvVariants = props.clinvarVariants ?? []
  return cvVariants.filter((v) => {
    if (v.proteinPosition === null || v.proteinPosition <= 0) return false
    const cat = getClinVarCategory(v.clinicalSignificance)
    if (clinvarFilter.value === 'pathogenic') return cat === 'pathogenic'
    if (clinvarFilter.value === 'likely_pathogenic')
      return cat === 'pathogenic' || cat === 'likely_pathogenic'
    return cat === 'pathogenic' || cat === 'likely_pathogenic'
  })
})

/** Filtered variants passed to the 3D viewer based on toggle state */
const filteredUserVariants = computed(() => (showUserVariants.value ? props.variants : []))
const filteredClinvarVariants = computed(() =>
  showClinvarVariants.value ? pathogenicClinvarVariants.value : []
)

const activeRepresentation = computed<RepresentationType>(
  () => molstarViewerRef.value?.activeRepresentation ?? 'cartoon'
)

const structureLoaded = computed(() => molstarViewerRef.value?.structureLoaded ?? false)

function onRepresentationChange(type: RepresentationType): void {
  molstarViewerRef.value?.setRepresentation(type)
}

function onVariantStyleChange(style: VariantStyle): void {
  variantStyle.value = style
  molstarViewerRef.value?.setVariantStyle(style)
}

function onResetView(): void {
  molstarViewerRef.value?.resetView()
}

function onVariantClick(variant: LollipopVariant): void {
  molstarViewerRef.value?.focusResidue(variant.proteinPosition)
}

function onClinvarClick(cv: ClinVarVariant): void {
  if (cv.proteinPosition !== null) {
    molstarViewerRef.value?.focusResidue(cv.proteinPosition)
  }
}
</script>

<template>
  <div class="structure-3d-panel d-flex flex-column fill-height">
    <!-- Controls toolbar -->
    <StructureControls
      v-if="structureLoaded"
      :active-representation="activeRepresentation"
      :variant-style="variantStyle"
      :is-alpha-fold="isAlphaFold"
      :source-label="sourceLabel"
      @update:representation="onRepresentationChange"
      @update:variant-style="onVariantStyleChange"
      @reset-view="onResetView"
    />

    <!-- Main content area -->
    <div class="d-flex flex-grow-1" style="min-height: 0">
      <!-- 3D Viewer -->
      <div class="flex-grow-1" style="min-width: 0">
        <MolstarViewer
          ref="molstarViewerRef"
          :structure-info="props.structureInfo"
          :variants="filteredUserVariants"
          :clinvar-variants="filteredClinvarVariants"
          :variant-style="variantStyle"
        />
      </div>

      <!-- Variant sidebar (when variants or ClinVar exist) -->
      <div
        v-if="
          (missenseVariants.length > 0 || pathogenicClinvarVariants.length > 0) && structureLoaded
        "
        class="variant-sidebar"
      >
        <!-- Filter controls -->
        <div class="sidebar-header pa-2 pb-1">
          <div class="d-flex align-center mb-1">
            <v-icon size="14" :icon="mdiFilter" class="mr-1 text-medium-emphasis" />
            <span class="text-body-2 text-medium-emphasis font-weight-medium">Filters</span>
          </div>
          <v-switch
            v-model="showUserVariants"
            density="compact"
            hide-details
            color="primary"
            class="filter-switch"
          >
            <template #label>
              <span class="text-caption">User variants</span>
            </template>
          </v-switch>
          <v-switch
            v-model="showClinvarVariants"
            density="compact"
            hide-details
            color="primary"
            class="filter-switch"
          >
            <template #label>
              <span class="text-caption">ClinVar P/LP</span>
            </template>
          </v-switch>
          <v-select
            v-if="showClinvarVariants"
            v-model="clinvarFilter"
            :items="[
              { title: 'P + LP', value: 'all' },
              { title: 'Pathogenic only', value: 'pathogenic' },
              { title: 'Likely P+', value: 'likely_pathogenic' }
            ]"
            density="compact"
            variant="outlined"
            hide-details
            class="mt-1 text-caption"
          />
        </div>

        <!-- Your Variants section -->
        <template v-if="missenseVariants.length > 0 && showUserVariants">
          <div class="sidebar-header text-body-2 text-medium-emphasis pa-2 pb-1 font-weight-medium">
            <v-icon size="14" :icon="mdiTargetVariant" class="mr-1" />
            Your Variants ({{ missenseVariants.length }})
          </div>
          <v-list density="compact" class="pa-0" bg-color="transparent">
            <v-list-item
              v-for="variant in missenseVariants"
              :key="`${variant.chr}-${variant.pos}-${variant.ref}-${variant.alt}`"
              class="variant-list-item"
              @click="onVariantClick(variant)"
            >
              <template #prepend>
                <div
                  class="variant-color-dot mr-2"
                  :style="{ backgroundColor: getConsequenceColor(variant.consequence) }"
                />
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ variant.aaChange ?? `p.${variant.proteinPosition}` }}
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                Pos {{ variant.proteinPosition }}
                <span v-if="variant.highlighted" class="ml-1 text-primary font-weight-bold">
                  &#9733;
                </span>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </template>

        <!-- ClinVar P/LP section -->
        <template v-if="pathogenicClinvarVariants.length > 0 && showClinvarVariants">
          <div class="sidebar-header text-body-2 text-medium-emphasis pa-2 pb-1 font-weight-medium">
            <v-icon size="14" :icon="mdiMedicalBag" class="mr-1" />
            ClinVar P/LP ({{ pathogenicClinvarVariants.length }})
          </div>
          <v-list density="compact" class="pa-0" bg-color="transparent">
            <v-list-item
              v-for="cv in pathogenicClinvarVariants"
              :key="cv.variantId"
              class="variant-list-item"
              @click="onClinvarClick(cv)"
            >
              <template #prepend>
                <div
                  class="variant-color-dot mr-2"
                  :style="{
                    backgroundColor: CLINVAR_COLORS[getClinVarCategory(cv.clinicalSignificance)]
                  }"
                />
              </template>
              <v-list-item-title class="text-body-2 font-weight-medium">
                {{ cv.hgvsp ?? `p.${cv.proteinPosition}` }}
              </v-list-item-title>
              <v-list-item-subtitle class="text-caption">
                Pos {{ cv.proteinPosition }} &middot; {{ cv.clinicalSignificance }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.structure-3d-panel {
  background-color: #faf8f6;
  border-radius: 8px;
  overflow: hidden;
}

.variant-sidebar {
  width: 240px;
  flex-shrink: 0;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  overflow-y: auto;
  background-color: #faf8f6;
}

.sidebar-header {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.variant-list-item {
  cursor: pointer;
  transition: background-color 0.15s ease;
  min-height: 40px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.04);
}

.variant-list-item:hover {
  background-color: rgba(0, 0, 0, 0.06);
}

.variant-color-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.1);
}

.filter-switch {
  margin-top: 0;
  padding-top: 0;
}

.filter-switch :deep(.v-input__control) {
  min-height: 28px;
}

.filter-switch :deep(.v-switch__track) {
  height: 16px;
  width: 28px;
}

.filter-switch :deep(.v-switch__thumb) {
  height: 12px;
  width: 12px;
}
</style>
