<template>
  <v-select
    :model-value="modelValue"
    :items="statusItems"
    item-title="label"
    item-value="value"
    density="compact"
    variant="outlined"
    hide-details
    :disabled="disabled"
    placeholder="Set status..."
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template #selection="{ item }">
      <v-icon
        :icon="STATUS_ICONS[item.value as AffectedStatus]"
        :color="STATUS_COLORS[item.value as AffectedStatus]"
        size="small"
        class="mr-1"
      />
      {{ item.title }}
    </template>
    <template #item="{ item, props }">
      <v-list-item v-bind="props">
        <template #prepend>
          <v-icon
            :icon="STATUS_ICONS[item.value as AffectedStatus]"
            :color="STATUS_COLORS[item.value as AffectedStatus]"
            size="small"
          />
        </template>
      </v-list-item>
    </template>
  </v-select>
</template>

<script setup lang="ts">
import { STATUS_ICONS, STATUS_COLORS } from '../composables/useCaseMetadata'
import type { AffectedStatus } from '../../../shared/types/api'

defineProps<{
  modelValue: AffectedStatus | null
  disabled?: boolean
}>()

defineEmits<{
  'update:modelValue': [status: AffectedStatus]
}>()

const statusItems = [
  { value: 'affected' as AffectedStatus, label: 'Affected' },
  { value: 'unaffected' as AffectedStatus, label: 'Unaffected' },
  { value: 'unknown' as AffectedStatus, label: 'Unknown' }
]
</script>
