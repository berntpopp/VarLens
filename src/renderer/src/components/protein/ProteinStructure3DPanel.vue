<script setup lang="ts">
/**
 * ProteinStructure3DPanel - Assembly component for 3D protein structure viewer
 * Combines StructureControls, MolstarViewer, and a variant sidebar
 */

import { computed, ref } from 'vue'
import { mdiTargetVariant, mdiMedicalBag } from '@mdi/js'
import type {
  LollipopVariant,
  ClinVarVariant,
  ClinVarSignificance,
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

/** Filter state */
const showUserVariants = ref(true)
const activeClinvar = ref<Set<ClinVarSignificance>>(new Set(['pathogenic', 'likely_pathogenic']))
const variantStyle = ref<VariantStyle>('colored')

const clinvarChips: Array<{ key: ClinVarSignificance; label: string; color: string }> = [
  { key: 'pathogenic', label: 'Pathogenic', color: CLINVAR_COLORS.pathogenic },
  { key: 'likely_pathogenic', label: 'Likely P.', color: CLINVAR_COLORS.likely_pathogenic },
  { key: 'uncertain', label: 'VUS', color: CLINVAR_COLORS.uncertain },
  { key: 'likely_benign', label: 'Likely B.', color: CLINVAR_COLORS.likely_benign },
  { key: 'benign', label: 'Benign', color: CLINVAR_COLORS.benign }
]

function toggleClinvar(key: ClinVarSignificance): void {
  const next = new Set(activeClinvar.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  activeClinvar.value = next
}

function clinvarOnly(key: ClinVarSignificance): void {
  activeClinvar.value = new Set([key])
}

function clinvarAll(): void {
  activeClinvar.value = new Set(clinvarChips.map((c) => c.key))
}

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

/** Filter ClinVar variants by active significance chips + must have protein position */
const filteredClinvarVariants = computed(() => {
  const cvVariants = props.clinvarVariants ?? []
  return cvVariants.filter((v) => {
    if (v.proteinPosition === null || v.proteinPosition <= 0) return false
    const cat = getClinVarCategory(v.clinicalSignificance)
    return activeClinvar.value.has(cat)
  })
})

/** Counts per ClinVar category (for chip labels) */
const clinvarCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const v of props.clinvarVariants ?? []) {
    if (v.proteinPosition === null || v.proteinPosition <= 0) continue
    const cat = getClinVarCategory(v.clinicalSignificance)
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  return counts
})

/** Filtered variants passed to the 3D viewer based on toggle state */
const filteredUserVariants = computed(() => (showUserVariants.value ? props.variants : []))

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
          (missenseVariants.length > 0 || filteredClinvarVariants.length > 0) && structureLoaded
        "
        class="variant-sidebar"
      >
        <!-- Filter chips -->
        <div class="sidebar-header pa-2">
          <!-- User variant toggle -->
          <v-chip
            size="small"
            label
            :variant="showUserVariants ? 'flat' : 'outlined'"
            :color="showUserVariants ? 'primary' : 'grey'"
            class="mb-1 mr-1"
            @click="showUserVariants = !showUserVariants"
          >
            Your Variant
          </v-chip>

          <!-- ClinVar significance chips with inline "only" -->
          <div class="d-flex flex-wrap align-center ga-1 mt-1">
            <span class="text-caption text-medium-emphasis mr-1">ClinVar:</span>
            <template v-for="chip in clinvarChips" :key="chip.key">
              <span class="d-inline-flex align-center">
                <v-chip
                  size="x-small"
                  label
                  :variant="activeClinvar.has(chip.key) ? 'flat' : 'outlined'"
                  :color="activeClinvar.has(chip.key) ? chip.color : 'grey-lighten-1'"
                  :style="{ opacity: activeClinvar.has(chip.key) ? 1 : 0.5 }"
                  @click="toggleClinvar(chip.key)"
                >
                  {{ chip.label }} ({{ clinvarCounts[chip.key] ?? 0 }})
                </v-chip>
                <v-btn
                  size="x-small"
                  variant="text"
                  class="only-btn text-lowercase"
                  @click="clinvarOnly(chip.key)"
                >
                  only
                </v-btn>
              </span>
            </template>
            <v-chip
              size="x-small"
              label
              variant="outlined"
              color="grey-darken-1"
              @click="clinvarAll()"
            >
              All
            </v-chip>
          </div>
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
        <template v-if="filteredClinvarVariants.length > 0">
          <div class="sidebar-header text-body-2 text-medium-emphasis pa-2 pb-1 font-weight-medium">
            <v-icon size="14" :icon="mdiMedicalBag" class="mr-1" />
            ClinVar P/LP ({{ filteredClinvarVariants.length }})
          </div>
          <v-list density="compact" class="pa-0" bg-color="transparent">
            <v-list-item
              v-for="cv in filteredClinvarVariants"
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

.only-btn {
  font-size: 10px;
  min-width: 28px;
  height: 18px;
  padding: 0 3px;
  opacity: 0.5;
}

.only-btn:hover {
  opacity: 1;
}
</style>
