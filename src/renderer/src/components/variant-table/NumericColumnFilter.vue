<template>
  <v-card min-width="280" max-width="350">
    <v-card-title class="text-subtitle-2 py-2">Filter: {{ columnTitle }}</v-card-title>
    <v-divider />
    <v-card-text class="pa-3">
      <v-select
        v-model="selectedOperator"
        :items="operators"
        label="Operator"
        density="compact"
        variant="outlined"
        hide-details
        class="mb-3"
      />
      <v-text-field
        v-model.number="filterValue"
        label="Value"
        type="number"
        density="compact"
        variant="outlined"
        hide-details
      />
      <div v-if="min != null && max != null" class="text-caption text-medium-emphasis mt-2">
        Range: {{ min }} - {{ max }}
      </div>
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
 * NumericColumnFilter - Per-column numeric filter with operator selection.
 *
 * Renders a dropdown for comparison operator (=, !=, <, >, <=, >=)
 * and a number input field. Shows range hint when min/max are provided.
 */
import { ref } from 'vue'
import type { ColumnFilterOperator } from '../../../../shared/types/column-filters'

interface Props {
  /** Column display name shown in the card title */
  columnTitle: string
  /** Minimum value hint from column metadata */
  min?: number
  /** Maximum value hint from column metadata */
  max?: number
  /** Pre-selected operator */
  initialOperator?: ColumnFilterOperator
  /** Pre-filled numeric value */
  initialValue?: number
}

const props = withDefaults(defineProps<Props>(), {
  min: undefined,
  max: undefined,
  initialOperator: '=',
  initialValue: undefined
})

const emit = defineEmits<{
  apply: [payload: { operator: ColumnFilterOperator; value: number }]
  clear: []
}>()

const operators: ColumnFilterOperator[] = ['=', '!=', '<', '>', '<=', '>=']

const selectedOperator = ref<ColumnFilterOperator>(props.initialOperator)
const filterValue = ref<number | undefined>(props.initialValue)

function onApply() {
  if (filterValue.value == null || filterValue.value === '') return
  emit('apply', { operator: selectedOperator.value, value: Number(filterValue.value) })
}

function onClear() {
  emit('clear')
}
</script>
