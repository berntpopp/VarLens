<template>
  <v-text-field
    :model-value="modelValue ?? ''"
    class="mt-3"
    density="compact"
    variant="outlined"
    type="number"
    step="1"
    min="1"
    :label="CARRIER_FREQUENCY_COPY.maxCarriersLabel"
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
import { CARRIER_FREQUENCY_COPY } from '../../config/uiCopyConfig'

const props = defineProps<{
  /** The cap, or null when the filter is off */
  modelValue: number | null
  /** The case view says that the open case counts too */
  scope: 'case' | 'cohort'
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number | null]
}>()

const hint = computed(() => CARRIER_FREQUENCY_COPY.maxCarriersHint[props.scope])
</script>
