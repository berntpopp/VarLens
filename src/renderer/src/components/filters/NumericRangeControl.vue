<template>
  <div class="d-flex ga-2 align-center">
    <v-select
      :model-value="operator"
      :items="operatorItems"
      item-title="label"
      item-value="value"
      density="compact"
      variant="outlined"
      hide-details
      style="max-width: 80px"
      @update:model-value="updateOperator"
    />
    <v-text-field
      :model-value="value"
      type="number"
      density="compact"
      variant="outlined"
      hide-details
      placeholder="Value"
      style="max-width: 140px"
      :disabled="operator === undefined"
      @update:model-value="updateValue"
    />
    <v-btn
      v-if="operator !== undefined || value !== undefined"
      :icon="mdiClose"
      size="x-small"
      variant="text"
      density="compact"
      :aria-label="`Clear ${meta?.key ?? 'filter'}`"
      @click="clear"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * NumericRangeControl — inline single-operator numeric control for extension
 * columns in the filter drawer(s).
 *
 * The `ColumnFilter` protocol stores ONE `{ operator, value }` per column key,
 * so this control is intentionally single-bound: the user selects one of
 * `>=` / `<=` / `=` / `!=` and one numeric value. A previous iteration shipped
 * two Min/Max text fields which implied a simultaneous range but the last-
 * written bound silently overwrote the other — that was dishonest UX. If a
 * true range is ever needed for a column, the fix is to extend the
 * `ColumnFiltersParam` protocol (e.g. a `range` operator type or a second
 * synthetic key), not to paper over it in the control.
 *
 * For the common extension use cases this is sufficient:
 *   - `sv.length` >= 1000  (long SVs)
 *   - `cnv.copy_number` = 0  (homozygous deletion)
 *   - `str.repeat_count` >= 5
 */
import { computed } from 'vue'
import { mdiClose } from '@mdi/js'
import type {
  ColumnFilter,
  ColumnFilterMeta,
  ColumnFilterOperator
} from '../../../../shared/types/column-filters'

const props = defineProps<{
  modelValue?: ColumnFilter
  meta?: ColumnFilterMeta
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ColumnFilter | undefined]
}>()

const operatorItems: Array<{ value: ColumnFilterOperator; label: string }> = [
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: '=', label: '=' },
  { value: '!=', label: '≠' }
]

const operator = computed<ColumnFilterOperator | undefined>(() => {
  const op = props.modelValue?.operator
  if (op === '>=' || op === '<=' || op === '=' || op === '!=') {
    return op
  }
  return undefined
})

const value = computed<number | undefined>(() => {
  const v = props.modelValue?.value
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v))) return Number(v)
  return undefined
})

function updateOperator(nextOp: ColumnFilterOperator | null): void {
  if (nextOp === null) {
    emit('update:modelValue', undefined)
    return
  }
  if (value.value === undefined) {
    // Operator picked but no numeric value yet — wait for the user to type
    // the bound. Emitting a ColumnFilter with an invalid value would cause the
    // main-side translateColumnFilter to drop the clause, but we'd also send
    // a stale operator downstream.
    return
  }
  emit('update:modelValue', {
    operator: nextOp,
    value: value.value,
    includeEmpty: false
  })
}

function updateValue(v: string | null): void {
  if (v === null || v === '') {
    emit('update:modelValue', undefined)
    return
  }
  const num = Number(v)
  if (Number.isNaN(num)) return
  const op: ColumnFilterOperator = operator.value ?? '>='
  emit('update:modelValue', {
    operator: op,
    value: num,
    includeEmpty: false
  })
}

function clear(): void {
  emit('update:modelValue', undefined)
}
</script>
