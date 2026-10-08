<template>
  <v-text-field
    :model-value="modelValue ?? ''"
    class="mt-3"
    density="compact"
    variant="outlined"
    type="number"
    step="1"
    min="1"
    label="Seen in at most N cases"
    :hint="hint"
    persistent-hint
    clearable
    data-testid="max-carriers-field"
    @update:model-value="emit('update:modelValue', parseMaxCarriers($event))"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { parseMaxCarriers } from '../../utils/filters/maxCarriers'

const props = defineProps<{
  /** The cap, or null when the filter is off */
  modelValue: number | null
  /** The case view says that the open case counts too */
  scope: 'case' | 'cohort'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const hint = computed(() =>
  props.scope === 'case'
    ? 'Counts all cases in this database, including this case.'
    : 'Counts all cases in this database that carry the variant.'
)
</script>
