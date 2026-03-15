<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :width="panelWidth"
    aria-label="Filter options"
    @update:model-value="emit('update:open', $event)"
  >
    <!-- Left-edge resize handle -->
    <div class="filter-drawer-resize-handle" @mousedown="startResize" @dblclick="resetWidth" />
    <v-card flat class="h-100 d-flex flex-column">
      <!-- Header -->
      <v-toolbar color="transparent" density="compact" flat>
        <v-toolbar-title class="text-body-large font-weight-medium"> All Filters </v-toolbar-title>
        <v-chip
          v-if="activeFilterCount > 0"
          size="small"
          color="primary"
          variant="flat"
          class="mr-2"
        >
          {{ activeFilterCount }}
        </v-chip>
        <v-tooltip location="bottom">
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              icon
              size="x-small"
              variant="text"
              @click="allExpanded ? collapseAll() : expandAll()"
            >
              <v-icon size="small">{{
                allExpanded ? 'mdi-unfold-less-horizontal' : 'mdi-unfold-more-horizontal'
              }}</v-icon>
            </v-btn>
          </template>
          {{ allExpanded ? 'Collapse all' : 'Expand all' }}
        </v-tooltip>
        <v-btn icon size="small" @click="emit('update:open', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-toolbar>
      <v-divider />

      <!-- Scrollable filter groups -->
      <div class="flex-grow-1 overflow-y-auto">
        <slot />
      </div>

      <!-- Footer -->
      <v-divider />
      <div class="pa-3 d-flex justify-space-between">
        <v-btn
          variant="text"
          size="small"
          color="error"
          :disabled="activeFilterCount === 0"
          @click="emit('clear-all')"
        >
          <v-icon start>mdi-filter-off</v-icon>
          Clear All
        </v-btn>
        <v-btn variant="text" size="small" @click="emit('update:open', false)"> Done </v-btn>
      </div>
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useDisplay } from 'vuetify'
import { usePanelResize } from '../../composables/usePanelResize'

const { width: viewportWidth } = useDisplay()
const maxDrawerWidth = computed(() => Math.min(500, Math.floor(viewportWidth.value * 0.4)))

const { panelWidth, startResize, resetWidth } = usePanelResize({
  side: 'right',
  storageKey: 'varlens_filter_drawer_width',
  defaultWidth: 300,
  minWidth: 250,
  maxWidth: 500
})

// Clamp panel width when viewport shrinks
watch(maxDrawerWidth, (max) => {
  if (panelWidth.value > max) {
    panelWidth.value = max
  }
})

const props = defineProps<{
  open: boolean
  activeFilterCount: number
  expandedPanels: string[]
  allPanelValues: string[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:expandedPanels': [value: string[]]
  'clear-all': []
}>()

const allExpanded = computed(
  () =>
    props.allPanelValues.length > 0 && props.expandedPanels.length === props.allPanelValues.length
)

const expandAll = (): void => {
  emit('update:expandedPanels', [...props.allPanelValues])
}

const collapseAll = (): void => {
  emit('update:expandedPanels', [])
}
</script>

<style scoped>
.filter-drawer-resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 10;
  transition: background-color 0.15s ease;
}

.filter-drawer-resize-handle:hover {
  background-color: color-mix(in srgb, rgb(var(--v-theme-primary)) 20%, transparent);
}
</style>
