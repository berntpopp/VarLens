<template>
  <div class="d-flex align-center justify-space-between header-wrapper">
    <div class="d-flex align-center flex-grow-1 sortable-header" @click="toggleSort(headerColumn)">
      <span class="header-title">{{ headerColumn.title }}</span>
      <v-icon v-if="isSorted(headerColumn)" size="x-small" class="ml-1">
        {{ getSortIcon(headerColumn) }}
      </v-icon>
      <v-icon v-else size="x-small" class="ml-1 sort-icon-inactive">mdi-sort</v-icon>
    </div>
    <v-menu :close-on-content-click="false" location="bottom">
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          icon
          size="x-small"
          variant="text"
          :color="hasFilter ? 'primary' : undefined"
          @click.stop
        >
          <v-icon size="small">
            {{ hasFilter ? 'mdi-filter' : 'mdi-filter-outline' }}
          </v-icon>
          <v-tooltip activator="parent" location="bottom">Filter this column</v-tooltip>
        </v-btn>
      </template>
      <v-card min-width="250" max-width="350">
        <v-card-title class="text-subtitle-2 py-2"> Filter: {{ headerColumn.title }} </v-card-title>
        <v-divider />
        <v-card-text class="pa-3">
          <v-text-field
            :model-value="filterValue"
            label="Filter value"
            placeholder="Type to filter..."
            density="compact"
            variant="outlined"
            clearable
            hide-details
            autofocus
            @update:model-value="(v: string | null) => emit('update:filter', v)"
          >
            <template #prepend-inner>
              <v-icon size="small">mdi-magnify</v-icon>
            </template>
          </v-text-field>
          <div class="text-caption text-medium-emphasis mt-2">Case-insensitive partial match</div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-2">
          <v-spacer />
          <v-btn size="small" variant="text" @click="emit('clear-filter')"> Clear </v-btn>
        </v-card-actions>
      </v-card>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
/**
 * VariantColumnHeader - Custom header template for variant table columns
 *
 * Renders a sortable header with a per-column filter popover menu.
 * Extracted from VariantTable.vue to reduce template complexity.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VuetifyInternalColumn = any

interface Props {
  /** The Vuetify internal column object from the header slot */
  headerColumn: VuetifyInternalColumn
  /** Function to get the sort icon for a column (Vuetify returns IconValue - complex union type) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSortIcon: (...args: any[]) => any
  /** Function to toggle sort on a column */
  toggleSort: (column: VuetifyInternalColumn) => void
  /** Function to check if a column is sorted */
  isSorted: (column: VuetifyInternalColumn) => boolean
  /** Whether this column currently has an active filter */
  hasFilter: boolean
  /** Current filter value for this column */
  filterValue: string
}

defineProps<Props>()

const emit = defineEmits<{
  'update:filter': [value: string | null]
  'clear-filter': []
}>()
</script>

<style scoped>
.header-wrapper {
  width: 100%;
  gap: 4px;
}

.sortable-header {
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.sortable-header:hover {
  opacity: 0.7;
}

.header-title {
  font-weight: 600;
  font-size: 0.8125rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sort-icon-inactive {
  opacity: 0.3;
}

.sortable-header:hover .sort-icon-inactive {
  opacity: 0.6;
}
</style>
