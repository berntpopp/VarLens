<template>
  <v-menu :close-on-content-click="false" max-width="350">
    <template #activator="{ props }">
      <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-filter-cog">
        Filters
        <v-badge
          v-if="activeFilterCount !== undefined && activeFilterCount > 0"
          :content="activeFilterCount"
          color="primary"
          inline
          class="ml-1"
        />
        <v-tooltip activator="parent" location="bottom"
          >Show/hide and reorder filter groups</v-tooltip
        >
      </v-btn>
    </template>
    <v-card>
      <v-card-title class="text-subtitle-2 py-2"> Filter Settings </v-card-title>
      <v-divider />
      <v-card-text class="pa-0">
        <v-list density="compact" max-height="400" class="overflow-y-auto">
          <v-list-subheader class="text-caption">
            Drag to reorder. Checkbox = show/hide. Arrow = expand/collapse.
          </v-list-subheader>
          <draggable
            :model-value="filterGroups"
            item-key="id"
            handle=".drag-handle"
            :animation="200"
            @update:model-value="handleReorder"
          >
            <template #item="{ element: group }">
              <v-list-item class="px-2">
                <template #prepend>
                  <v-icon class="drag-handle mr-1" size="small">mdi-drag-vertical</v-icon>
                  <v-checkbox-btn
                    :model-value="group.visible"
                    hide-details
                    density="compact"
                    @click.stop="emit('toggle-visible', group.id)"
                  />
                  <v-btn
                    size="x-small"
                    variant="text"
                    density="compact"
                    :icon="group.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right'"
                    :disabled="!group.visible"
                    @click.stop="emit('toggle-expand', group.id)"
                  />
                </template>
                <v-list-item-title class="text-body-2" :class="{ 'text-disabled': !group.visible }">
                  <v-icon size="small" class="mr-1">{{ getFilterIcon(group.id) }}</v-icon>
                  {{ group.label }}
                </v-list-item-title>
              </v-list-item>
            </template>
          </draggable>
        </v-list>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-2 d-flex justify-space-between">
        <v-btn variant="text" size="small" prepend-icon="mdi-eye" @click="emit('show-all')">
          Show All
        </v-btn>
        <v-btn variant="text" size="small" prepend-icon="mdi-refresh" @click="emit('reset')">
          Reset
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import draggable from 'vuedraggable'

interface FilterGroup {
  id: string
  label: string
  visible: boolean
  expanded: boolean
}

defineProps<{
  filterGroups: FilterGroup[]
  activeFilterCount?: number
}>()

const emit = defineEmits<{
  'toggle-visible': [id: string]
  'toggle-expand': [id: string]
  reorder: [groups: FilterGroup[]]
  reset: []
  'show-all': []
}>()

const handleReorder = (newOrder: FilterGroup[]) => {
  emit('reorder', newOrder)
}

const getFilterIcon = (id: string): string => {
  const icons: Record<string, string> = {
    search: 'mdi-magnify',
    gene: 'mdi-dna',
    impact: 'mdi-flash',
    function: 'mdi-function',
    clinvar: 'mdi-hospital-box',
    frequency: 'mdi-account-group',
    cadd: 'mdi-alert-circle',
    tags: 'mdi-tag-multiple'
  }
  return icons[id] || 'mdi-filter'
}
</script>

<style scoped>
.drag-handle {
  cursor: grab;
  opacity: 0.5;
}

.drag-handle:hover {
  opacity: 1;
}
</style>
