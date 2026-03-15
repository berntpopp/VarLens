<template>
  <v-card min-width="200" max-width="300" class="filter-popup">
    <v-card-title class="text-caption font-weight-medium py-1 px-3">
      Filter: {{ columnTitle }}
    </v-card-title>
    <v-divider />
    <v-card-text class="pa-2">
      <v-autocomplete
        v-model="filterValue"
        :items="suggestions"
        placeholder="Type to filter..."
        density="compact"
        variant="outlined"
        clearable
        hide-details
        auto-select-first
        prepend-inner-icon="mdi-magnify"
      />
    </v-card-text>
    <v-divider />
    <v-card-actions class="pa-1 px-2">
      <v-btn size="x-small" variant="text" @click="onClear">Clear</v-btn>
      <v-spacer />
      <v-btn size="x-small" variant="text" color="primary" @click="onApply">Apply</v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup lang="ts">
/**
 * TextSuggestColumnFilter - Per-column text filter with autocomplete suggestions.
 *
 * Shows a v-autocomplete with suggestions from distinct column values.
 * Emits a 'like' operator filter with the entered text.
 */
import { ref } from 'vue'
import type { ColumnFilterOperator } from '../../../../shared/types/column-filters'

interface Props {
  /** Column display name shown in the card title */
  columnTitle: string
  /** Suggestion list from column metadata distinct values */
  suggestions: string[]
  /** Pre-filled text value */
  initialValue?: string
}

const props = withDefaults(defineProps<Props>(), {
  initialValue: ''
})

const emit = defineEmits<{
  apply: [payload: { operator: ColumnFilterOperator; value: string }]
  clear: []
}>()

const filterValue = ref<string>(props.initialValue)

function onApply() {
  if (!filterValue.value) return
  emit('apply', { operator: 'like', value: filterValue.value })
}

function onClear() {
  emit('clear')
}
</script>
