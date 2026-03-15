<template>
  <v-card min-width="220" max-width="300" class="filter-popup">
    <v-card-title class="text-caption font-weight-medium py-1 px-3">
      Filter: {{ columnTitle }}
    </v-card-title>
    <v-divider />
    <v-card-text class="pa-2">
      <div class="d-flex ga-1 mb-1">
        <v-select
          v-model="selectedOperator"
          :items="operators"
          density="compact"
          variant="outlined"
          hide-details
          style="min-width: 80px; max-width: 100px"
        />
        <v-text-field
          v-model.number="filterValue"
          placeholder="Value"
          type="number"
          density="compact"
          variant="outlined"
          hide-details
        />
      </div>
      <div v-if="min != null && max != null" class="text-caption text-medium-emphasis">
        Range: {{ min }} - {{ max }}
      </div>
      <v-checkbox
        v-if="isRangeOperator"
        v-model="includeEmpty"
        label="Include empty"
        density="compact"
        hide-details
        class="include-empty-toggle mt-1"
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
 * NumericColumnFilter - Per-column numeric filter with operator selection.
 *
 * Renders a dropdown for comparison operator (=, !=, <, >, <=, >=)
 * and a number input field. Shows range hint when min/max are provided.
 * For range operators (<, >, <=, >=), shows an "Include empty" toggle
 * that defaults to ON (preserving unannotated variants).
 */
import { ref, computed } from 'vue'
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
  /** Pre-set include empty state */
  initialIncludeEmpty?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  min: undefined,
  max: undefined,
  initialOperator: '=',
  initialValue: undefined,
  initialIncludeEmpty: true
})

const emit = defineEmits<{
  apply: [payload: { operator: ColumnFilterOperator; value: number; includeEmpty?: boolean }]
  clear: []
}>()

const operators: ColumnFilterOperator[] = ['=', '!=', '<', '>', '<=', '>=']
const RANGE_OPERATORS = new Set(['<', '>', '<=', '>='])

const selectedOperator = ref<ColumnFilterOperator>(props.initialOperator)
const filterValue = ref<number | undefined>(props.initialValue)
const includeEmpty = ref(props.initialIncludeEmpty)

const isRangeOperator = computed(() => RANGE_OPERATORS.has(selectedOperator.value))

function onApply() {
  if (filterValue.value == null) return
  emit('apply', {
    operator: selectedOperator.value,
    value: Number(filterValue.value),
    includeEmpty: isRangeOperator.value ? includeEmpty.value : undefined
  })
}

function onClear() {
  emit('clear')
}
</script>

<style scoped>
.include-empty-toggle :deep(.v-label) {
  font-size: 0.75rem;
}

.include-empty-toggle :deep(.v-selection-control) {
  min-height: 28px;
}
</style>
