<template>
  <v-menu :close-on-content-click="false" max-width="350">
    <template #activator="{ props }">
      <v-btn v-bind="props" size="small" variant="tonal" prepend-icon="mdi-table-column">
        Columns
        <v-tooltip activator="parent" location="bottom">Show/hide and reorder columns</v-tooltip>
      </v-btn>
    </template>
    <v-card>
      <v-card-title class="text-subtitle-2 py-2"> Column Settings </v-card-title>
      <v-divider />
      <v-card-text class="pa-0">
        <v-list density="compact" max-height="400" class="overflow-y-auto">
          <v-list-subheader class="text-caption">
            Drag to reorder, click checkbox to show/hide
          </v-list-subheader>
          <draggable
            :model-value="columns"
            item-key="key"
            handle=".drag-handle"
            :animation="200"
            @update:model-value="handleReorder"
          >
            <template #item="{ element: column }">
              <v-list-item class="px-2">
                <template #prepend>
                  <v-icon class="drag-handle mr-2" size="small">mdi-drag-vertical</v-icon>
                  <v-checkbox-btn
                    :model-value="visibleColumns.includes(column.key)"
                    hide-details
                    @click.stop="emit('toggle:column', column.key)"
                  />
                </template>
                <v-list-item-title class="text-body-2">{{ column.title }}</v-list-item-title>
              </v-list-item>
            </template>
          </draggable>
        </v-list>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-2">
        <v-btn variant="text" size="small" prepend-icon="mdi-refresh" @click="emit('reset')">
          Reset to Defaults
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import draggable from 'vuedraggable'

interface Column {
  key: string
  title: string
}

defineProps<{
  columns: Column[]
  visibleColumns: string[]
  tableId: string
}>()

const emit = defineEmits<{
  'toggle:column': [key: string]
  reorder: [keys: string[]]
  reset: []
}>()

const handleReorder = (newOrder: Column[]) => {
  emit(
    'reorder',
    newOrder.map((c) => c.key)
  )
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
