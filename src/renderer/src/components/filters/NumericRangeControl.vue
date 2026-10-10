<template>
  <div class="d-flex ga-2 align-center">
    <v-select
      :model-value="selectedOperator"
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
      @update:model-value="updateValue"
    />
    <v-btn
      v-if="modelValue !== undefined"
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
import { ref, computed, watch } from 'vue'
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

const validOperators: ColumnFilterOperator[] = ['>=', '<=', '=', '!=']

function isValidOp(op: unknown): op is ColumnFilterOperator {
  return typeof op === 'string' && (validOperators as string[]).includes(op)
}

const selectedOperator = ref<ColumnFilterOperator>(
  isValidOp(props.modelValue?.operator) ? props.modelValue.operator : '>='
)

watch(
  () => props.modelValue?.operator,
  (newOp) => {
    if (isValidOp(newOp)) {
      selectedOperator.value = newOp
    }
  }
)

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
  selectedOperator.value = nextOp
  if (value.value !== undefined) {
    emit('update:modelValue', {
      operator: nextOp,
      value: value.value,
      includeEmpty: false
    })
  }
}

function updateValue(v: string | null): void {
  if (v === null || v === '') {
    emit('update:modelValue', undefined)
    return
  }
  const num = Number(v)
  if (Number.isNaN(num)) return
  emit('update:modelValue', {
    operator: selectedOperator.value,
    value: num,
    includeEmpty: false
  })
}

function clear(): void {
  emit('update:modelValue', undefined)
}
</script>
