<script setup lang="ts">
/**
 * ProteinStructure3DPanel - Assembly component for 3D protein structure viewer
 * Combines StructureControls, MolstarViewer, and a variant sidebar
 */

import { computed, ref } from 'vue'
import { mdiTargetVariant } from '@mdi/js'
import type { LollipopVariant, ProteinStructureInfo } from '../../../../shared/types/protein'
import { getConsequenceColor } from '../../../../shared/utils/protein-utils'
import MolstarViewer from './MolstarViewer.vue'
import StructureControls from './StructureControls.vue'
import type { RepresentationType } from '../../composables/useMolstarViewer'

const props = defineProps<{
  structureInfo: ProteinStructureInfo | null
  variants: LollipopVariant[]
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

const activeRepresentation = computed<RepresentationType>(
  () => molstarViewerRef.value?.activeRepresentation ?? 'cartoon'
)

const structureLoaded = computed(() => molstarViewerRef.value?.structureLoaded ?? false)

function onRepresentationChange(type: RepresentationType): void {
  molstarViewerRef.value?.setRepresentation(type)
}

function onResetView(): void {
  molstarViewerRef.value?.resetView()
}

function onVariantClick(variant: LollipopVariant): void {
  molstarViewerRef.value?.focusResidue(variant.proteinPosition)
}
</script>

<template>
  <div class="structure-3d-panel d-flex flex-column fill-height">
    <!-- Controls toolbar -->
    <StructureControls
      v-if="structureLoaded"
      :active-representation="activeRepresentation"
      :is-alpha-fold="isAlphaFold"
      :source-label="sourceLabel"
      @update:representation="onRepresentationChange"
      @reset-view="onResetView"
    />

    <!-- Main content area -->
    <div class="d-flex flex-grow-1" style="min-height: 0">
      <!-- 3D Viewer -->
      <div class="flex-grow-1" style="min-width: 0">
        <MolstarViewer
          ref="molstarViewerRef"
          :structure-info="props.structureInfo"
          :variants="props.variants"
        />
      </div>

      <!-- Variant sidebar (only when missense variants exist) -->
      <div v-if="missenseVariants.length > 0 && structureLoaded" class="variant-sidebar">
        <div class="sidebar-header text-body-2 text-medium-emphasis pa-2 pb-1 font-weight-medium">
          <v-icon size="14" :icon="mdiTargetVariant" class="mr-1" />
          Missense Variants ({{ missenseVariants.length }})
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
</style>
