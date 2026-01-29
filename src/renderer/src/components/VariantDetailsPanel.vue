<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :persistent="true"
    :width="panelWidth"
    @update:model-value="emit('update:open', $event)"
  >
    <!-- Resize handle (left edge) -->
    <div class="resize-handle" @mousedown="startResize" />

    <v-card flat class="h-100 d-flex flex-column">
      <!-- Header with title and close button -->
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-subtitle-1"> Variant Details </v-toolbar-title>
        <v-btn icon size="small" @click="emit('update:open', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>

      <v-divider />

      <!-- Scrollable content area (placeholder for now) -->
      <div class="flex-grow-1 overflow-y-auto pa-3">
        <div v-if="variant" class="text-body-2">
          <strong>{{ variant.gene_symbol ?? 'Unknown' }}</strong>
          <div>{{ variant.chr }}:{{ variant.pos }}</div>
          <div>{{ variant.ref }} > {{ variant.alt }}</div>
        </div>
        <div v-else class="text-grey text-center">No variant selected</div>
      </div>
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { usePanelResize } from '../composables/usePanelResize'
import type { Variant } from '../../../shared/types/api'
import type { CohortVariant } from '../../../shared/types/cohort'

interface Props {
  open: boolean
  variant: Variant | CohortVariant | null
  caseId: number | null
  mode: 'case' | 'cohort'
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

// Use panel resize composable
const { panelWidth, startResize } = usePanelResize()

// Handle Escape key to close panel
const handleKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.open) {
    emit('update:open', false)
  }
}

// Add Escape listener on mount
onMounted(() => {
  // eslint-disable-next-line no-undef
  window.addEventListener('keydown', handleKeydown)
})

// Clean up Escape listener on unmount
onUnmounted(() => {
  // eslint-disable-next-line no-undef
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  background: transparent;
  z-index: 10;
}

.resize-handle:hover {
  background: rgba(var(--v-theme-primary), 0.2);
}
</style>
