<template>
  <v-navigation-drawer
    :model-value="open"
    location="right"
    temporary
    :width="340"
    @update:model-value="emit('update:open', $event)"
  >
    <v-card flat class="d-flex flex-column h-100">
      <!-- Header -->
      <v-toolbar density="compact" flat>
        <v-toolbar-title class="text-body-large font-weight-medium">
          <v-icon size="small" class="mr-1" :icon="mdiTableColumn" />
          Columns
        </v-toolbar-title>
        <v-spacer />
        <v-btn
          aria-label="Close columns panel"
          :icon="mdiClose"
          size="small"
          variant="text"
          @click="emit('update:open', false)"
        />
      </v-toolbar>
      <v-divider />

      <!-- Scrollable content -->
      <div class="flex-grow-1 overflow-y-auto pa-2">
        <template v-for="[groupId, groupCols] in groupedColumns" :key="groupId">
          <div v-if="groupCols.length > 0 || groupId === 'links'" class="column-group mb-3">
            <!-- Group header -->
            <div class="group-header d-flex align-center px-2 py-1 rounded bg-grey-lighten-3">
              <v-icon size="small" class="mr-2">{{ groupIcon(groupId) }}</v-icon>
              <span class="text-body-small font-weight-bold text-uppercase">
                {{ groupLabel(groupId) }}
              </span>
              <v-spacer />
              <v-checkbox-btn
                :model-value="isGroupAllVisible(groupId)"
                :indeterminate="isGroupIndeterminate(groupId)"
                density="compact"
                hide-details
                @click.stop="toggleGroup(groupId)"
              />
            </div>

            <!-- Empty state for links group -->
            <div
              v-if="groupCols.length === 0"
              class="text-body-small text-medium-emphasis pa-2 text-center"
            >
              No external link columns configured
            </div>

            <!-- Column list within group -->
            <v-list v-else density="compact" class="py-0">
              <draggable
                :model-value="groupCols"
                item-key="key"
                handle=".column-drag-handle"
                :animation="200"
                :group="{ name: 'columns', pull: false, put: false }"
                @update:model-value="(newOrder: Column[]) => handleGroupReorder(groupId, newOrder)"
              >
                <template #item="{ element: column }">
                  <v-list-item class="px-1" :ripple="false">
                    <template #prepend>
                      <v-icon
                        class="column-drag-handle mr-1"
                        size="x-small"
                        :icon="mdiDragVertical"
                      />
                      <v-checkbox-btn
                        :model-value="visibleColumns.includes(column.key)"
                        density="compact"
                        hide-details
                        @click.stop="emit('toggle:column', column.key)"
                      />
                    </template>
                    <v-list-item-title class="text-body-medium">{{
                      column.title
                    }}</v-list-item-title>
                  </v-list-item>
                </template>
              </draggable>
            </v-list>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <v-divider />
      <div class="pa-3 d-flex align-center">
        <span class="text-body-small text-medium-emphasis">
          {{ visibleColumns.length }} of {{ columns.length }} columns visible
        </span>
        <v-spacer />
        <v-btn size="small" variant="text" class="mr-1" @click="showAll"> Show All </v-btn>
        <v-btn size="small" variant="tonal" :prepend-icon="mdiRefresh" @click="emit('reset')">
          Reset
        </v-btn>
      </div>
    </v-card>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import { groupColumns, getGroupConfig } from '../config/columnGroups'
import {
  mdiClose,
  mdiDragVertical,
  mdiHelpCircleOutline,
  mdiRefresh,
  mdiTableColumn
} from '@mdi/js'

interface Column {
  key: string
  title: string
}

const props = defineProps<{
  open: boolean
  columns: Column[]
  visibleColumns: string[]
  tableId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'toggle:column': [key: string]
  reorder: [keys: string[]]
  reset: []
}>()

/** Columns organized by group */
const groupedColumns = computed(() => groupColumns(props.columns))

/** Get icon for a group */
const groupIcon = (groupId: string): string => {
  return getGroupConfig(groupId)?.icon ?? mdiHelpCircleOutline
}

/** Get label for a group */
const groupLabel = (groupId: string): string => {
  return getGroupConfig(groupId)?.label ?? groupId
}

/** Get column keys for a group */
const groupColumnKeys = (groupId: string): string[] => {
  const cols = groupedColumns.value.get(groupId)
  return cols ? cols.map((c) => c.key) : []
}

/** Check if all columns in a group are visible */
const isGroupAllVisible = (groupId: string): boolean => {
  const keys = groupColumnKeys(groupId)
  if (keys.length === 0) return false
  return keys.every((k) => props.visibleColumns.includes(k))
}

/** Check if some (but not all) columns in a group are visible */
const isGroupIndeterminate = (groupId: string): boolean => {
  const keys = groupColumnKeys(groupId)
  if (keys.length === 0) return false
  const visibleCount = keys.filter((k) => props.visibleColumns.includes(k)).length
  return visibleCount > 0 && visibleCount < keys.length
}

/** Toggle all columns in a group: if all visible -> hide all, else -> show all */
const toggleGroup = (groupId: string): void => {
  const keys = groupColumnKeys(groupId)
  if (keys.length === 0) return
  const allVisible = isGroupAllVisible(groupId)
  for (const key of keys) {
    const isVisible = props.visibleColumns.includes(key)
    if (allVisible && isVisible) {
      emit('toggle:column', key)
    } else if (!allVisible && !isVisible) {
      emit('toggle:column', key)
    }
  }
}

/** Show all columns (toggle each hidden column) */
const showAll = (): void => {
  for (const col of props.columns) {
    if (!props.visibleColumns.includes(col.key)) {
      emit('toggle:column', col.key)
    }
  }
}

/** Handle reorder within a group, then emit full column order */
const handleGroupReorder = (groupId: string, newOrder: Column[]): void => {
  // Replace the group's columns with the new order, keep all other groups as-is
  const fullOrder: string[] = []
  for (const [gId] of groupedColumns.value) {
    if (gId === groupId) {
      fullOrder.push(...newOrder.map((c) => c.key))
    } else {
      const groupCols = groupedColumns.value.get(gId)
      if (groupCols) {
        fullOrder.push(...groupCols.map((c) => c.key))
      }
    }
  }
  emit('reorder', fullOrder)
}
</script>

<style scoped>
.column-drag-handle {
  cursor: grab;
  opacity: 0.4;
  transition: opacity 0.15s;
}

.column-drag-handle:hover {
  opacity: 0.9;
}

.column-drag-handle:active {
  cursor: grabbing;
}

.group-header {
  user-select: none;
}
</style>
