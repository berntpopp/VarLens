<template>
  <v-select
    :model-value="selectedValues"
    :items="options"
    multiple
    chips
    closable-chips
    density="compact"
    variant="outlined"
    hide-details
    :placeholder="options.length === 0 ? '(no values in scope)' : 'Select values'"
    @update:model-value="onUpdate"
  />
</template>

<script setup lang="ts">
/**
 * EnumSelectControl — inline multi-select sidebar input for extension enum
 * columns. Options come from `meta.distinctValues` (populated by the
 * `variants:columnMeta` IPC when the column's distinctCount is below the
 * backend threshold).
 *
 * Emits `update:modelValue` with `{ operator: 'in', value: string[] }` or
 * `undefined` when no values are selected (so the parent clears the entry
 * from the filter map).
 */
import { computed } from 'vue'
import type { ColumnFilter, ColumnFilterMeta } from '../../../../shared/types/column-filters'

const props = defineProps<{
  modelValue?: ColumnFilter
  meta?: ColumnFilterMeta
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ColumnFilter | undefined]
}>()

const options = computed<string[]>(() => props.meta?.distinctValues ?? [])

const selectedValues = computed<string[]>(() => {
  if (props.modelValue?.operator === 'in' && Array.isArray(props.modelValue.value)) {
    return props.modelValue.value.map(String)
  }
  return []
})

function onUpdate(values: string[]): void {
  if (values.length === 0) {
    emit('update:modelValue', undefined)
    return
  }
  emit('update:modelValue', { operator: 'in', value: values, includeEmpty: false })
}
</script>
