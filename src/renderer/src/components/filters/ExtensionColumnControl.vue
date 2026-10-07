<template>
  <div class="extension-filter-row mb-3">
    <div class="text-caption text-medium-emphasis mb-1">{{ column.label }}</div>
    <component
      :is="CONTROLS[column.kind] ?? TextFilterControl"
      :model-value="modelValue"
      :meta="meta"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * One extension column's filter control, with the column's metadata (bounds,
 * distinct values) for the current scope. The metadata is a query, so it
 * follows the scope, is shared with every other consumer of the same column,
 * and a failed load is not repeated on re-render.
 */
import type { Component } from 'vue'
import { useQuery } from '@pinia/colada'
import type { ColumnFilter } from '../../../../shared/types/column-filters'
import type { FilterKind } from '../../../../shared/types/variant-extension-registry-data'
import { columnMetaQuery } from '../../queries/column-meta'
import type { QueryScope } from '../../queries/keys'
import NumericRangeControl from './NumericRangeControl.vue'
import EnumSelectControl from './EnumSelectControl.vue'
import TextFilterControl from './TextFilterControl.vue'

const CONTROLS: Partial<Record<FilterKind, Component>> = {
  number: NumericRangeControl,
  enum: EnumSelectControl
}

const props = defineProps<{
  scope: QueryScope
  column: { dottedKey: string; label: string; kind: FilterKind }
  modelValue: ColumnFilter | undefined
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ColumnFilter | undefined]
}>()

const { data: meta } = useQuery(() =>
  columnMetaQuery({ scope: props.scope, columnKey: props.column.dottedKey })
)
</script>
