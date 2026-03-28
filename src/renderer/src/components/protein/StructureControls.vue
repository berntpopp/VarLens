<script setup lang="ts">
/**
 * StructureControls - Toolbar for 3D protein structure viewer
 * Provides representation toggle, reset view, and pLDDT confidence legend
 */

import {
  mdiRefresh,
  mdiRibbon,
  mdiCircleOutline,
  mdiAtom,
  mdiAlphaACircle,
  mdiDatabase
} from '@mdi/js'
import type { RepresentationType } from '../../composables/useMolstarViewer'

defineProps<{
  activeRepresentation: RepresentationType
  isAlphaFold: boolean
  sourceLabel: string
}>()

const emit = defineEmits<{
  (e: 'update:representation', type: RepresentationType): void
  (e: 'reset-view'): void
}>()

/** pLDDT confidence color legend for AlphaFold structures */
const plddtLegend = [
  { label: '>90', color: '#0053D6', description: 'Very high' },
  { label: '70-90', color: '#65CBF3', description: 'Confident' },
  { label: '50-70', color: '#FFDB13', description: 'Low' },
  { label: '<50', color: '#FF7D45', description: 'Very low' }
]

const representations: Array<{ value: RepresentationType; label: string; icon: string }> = [
  { value: 'cartoon', label: 'Cartoon', icon: mdiRibbon },
  { value: 'molecular-surface', label: 'Surface', icon: mdiCircleOutline },
  { value: 'ball-and-stick', label: 'Ball+Stick', icon: mdiAtom }
]
</script>

<template>
  <v-toolbar density="compact" flat color="transparent" class="structure-controls">
    <!-- Representation toggle -->
    <v-btn-group density="compact" variant="outlined" divided class="mr-3">
      <v-btn
        v-for="rep in representations"
        :key="rep.value"
        :color="activeRepresentation === rep.value ? 'primary' : undefined"
        :variant="activeRepresentation === rep.value ? 'flat' : 'outlined'"
        size="small"
        @click="emit('update:representation', rep.value)"
      >
        <v-icon start size="16" :icon="rep.icon" />
        {{ rep.label }}
      </v-btn>
    </v-btn-group>

    <!-- Reset view button -->
    <v-btn variant="text" size="small" :prepend-icon="mdiRefresh" @click="emit('reset-view')">
      Reset
    </v-btn>

    <v-spacer />

    <!-- Source indicator chip -->
    <v-chip size="small" variant="tonal" :color="isAlphaFold ? 'blue' : 'green'" class="mr-2">
      <v-icon start size="14" :icon="isAlphaFold ? mdiAlphaACircle : mdiDatabase" />
      {{ sourceLabel }}
    </v-chip>

    <!-- pLDDT confidence legend (AlphaFold only) -->
    <div v-if="isAlphaFold" class="plddt-legend d-flex align-center ga-1">
      <span class="text-caption text-medium-emphasis mr-1">pLDDT:</span>
      <div
        v-for="item in plddtLegend"
        :key="item.label"
        class="d-flex align-center ga-1"
        :title="`${item.description} (${item.label})`"
      >
        <div class="plddt-swatch" :style="{ backgroundColor: item.color }" />
        <span class="text-caption text-medium-emphasis">{{ item.label }}</span>
      </div>
    </div>
  </v-toolbar>
</template>

<style scoped>
.structure-controls {
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}

.plddt-legend {
  flex-shrink: 0;
}

.plddt-swatch {
  width: 12px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>
