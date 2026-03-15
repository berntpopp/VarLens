<template>
  <v-card min-width="280" max-width="350">
    <v-card-title class="text-subtitle-2 py-2">Filter: {{ columnTitle }}</v-card-title>
    <v-divider />
    <v-card-text class="pa-3">
      <v-autocomplete
        v-model="filterValue"
        :items="suggestions"
        label="Type to filter..."
        density="compact"
        variant="outlined"
        clearable
        hide-details
        auto-select-first
      >
        <template #prepend-inner>
          <v-icon size="small">mdi-magnify</v-icon>
        </template>
      </v-autocomplete>
      <div class="text-caption text-medium-emphasis mt-2">Case-insensitive partial match</div>
    </v-card-text>
    <v-divider />
    <v-card-actions class="pa-2">
      <v-btn size="small" variant="text" @click="onClear">Clear</v-btn>
      <v-spacer />
      <v-btn size="small" variant="text" color="primary" @click="onApply">Apply</v-btn>
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
