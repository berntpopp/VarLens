<script setup lang="ts">
/**
 * MolstarViewer - pdbe-molstar Web Component wrapper
 * Renders a 3D protein structure with variant highlighting
 *
 * The <pdbe-molstar> custom element is registered by the global script
 * tag in index.html (pdbe-molstar-component.js). The CSS is also loaded
 * globally (pdbe-molstar-light.css). This avoids bundling the 6 MB IIFE
 * through Vite.
 */

import { ref, computed, watch, type Ref } from 'vue'
import { mdiMolecule } from '@mdi/js'
import { useMolstarViewer } from '../../composables/useMolstarViewer'
import type { VariantStyle } from '../../composables/useMolstarViewer'
import type {
  LollipopVariant,
  ClinVarVariant,
  ProteinStructureInfo
} from '../../../../shared/types/protein'

const props = defineProps<{
  structureInfo: ProteinStructureInfo | null
  variants: LollipopVariant[]
  clinvarVariants?: ClinVarVariant[]
  variantStyle?: VariantStyle
}>()

const molstarRef = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>

// Determine the active structure source (prefer AlphaFold, fallback PDB)
const activeSource = computed(() => {
  if (props.structureInfo === null) return null
  return props.structureInfo.alphafold ?? props.structureInfo.pdb ?? null
})

const structureUrl = computed(() => activeSource.value?.url ?? null)
const structureFormat = computed(() => activeSource.value?.format ?? 'cif')

// Reactive refs for the composable
const structureInfoRef = computed(() => props.structureInfo)
const variantsRef = computed(() => props.variants)
const clinvarRef = computed(() => props.clinvarVariants ?? [])

const {
  loading,
  error,
  structureLoaded,
  activeRepresentation,
  focusResidue,
  setRepresentation,
  setVariantStyle,
  resetView
} = useMolstarViewer(molstarRef, structureInfoRef, variantsRef, clinvarRef)

// Sync variant style prop to composable
watch(
  () => props.variantStyle,
  (style) => {
    if (style !== undefined) {
      setVariantStyle(style)
    }
  }
)

defineExpose({
  focusResidue,
  setRepresentation,
  setVariantStyle,
  resetView,
  activeRepresentation,
  structureLoaded
})
</script>

<template>
  <div class="molstar-viewer-container">
    <!-- Loading overlay -->
    <div v-if="loading" class="molstar-overlay">
      <v-progress-circular indeterminate color="primary" size="48" />
      <span class="text-body-2 mt-3 text-medium-emphasis">Loading structure...</span>
    </div>

    <!-- Error state -->
    <v-alert v-else-if="error" type="error" variant="tonal" class="ma-4">
      {{ error }}
    </v-alert>

    <!-- Empty state -->
    <div v-else-if="!structureUrl" class="molstar-overlay">
      <v-icon size="64" color="grey-lighten-1" :icon="mdiMolecule" />
      <span class="text-body-2 mt-3 text-medium-emphasis">
        No 3D structure available for this protein
      </span>
    </div>

    <!-- pdbe-molstar Web Component
         The :key includes activeRepresentation so Vue destroys and recreates the
         element when the representation changes. This avoids the fullLoad bug in
         pdbe-molstar where visual.update(opts, true) resets the background to black
         and the setBgColor API cannot restore it. A fresh element always renders
         with the correct bg-color attributes. -->
    <pdbe-molstar
      v-if="structureUrl"
      ref="molstarRef"
      :key="`${structureUrl}-${activeRepresentation}`"
      :custom-data-url="structureUrl"
      :custom-data-format="structureFormat"
      :visual-style="activeRepresentation"
      hide-controls="true"
      landscape="true"
      bg-color-r="250"
      bg-color-g="248"
      bg-color-b="246"
      :style="{ visibility: structureLoaded ? 'visible' : 'hidden' }"
      class="molstar-element"
    />
  </div>
</template>

<style scoped>
.molstar-viewer-container {
  position: relative;
  width: 100%;
  min-height: 400px;
  height: 100%;
  background-color: #faf8f6;
  border-radius: 8px;
  overflow: hidden;
}

.molstar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 1;
  background-color: #faf8f6;
}

.molstar-element {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
