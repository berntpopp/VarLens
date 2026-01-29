<template>
  <v-combobox
    :model-value="modelValue"
    :items="availableCohorts"
    item-title="name"
    item-value="id"
    multiple
    chips
    closable-chips
    density="compact"
    variant="outlined"
    hide-details
    :disabled="disabled"
    placeholder="Assign cohorts..."
    return-object
    @update:model-value="handleSelectionChange"
  >
    <template #chip="{ item, props }">
      <v-chip v-bind="props" :color="getCohortColor(item.raw.name)" size="small" label>
        {{ item.raw.name }}
      </v-chip>
    </template>
    <template #item="{ item, props }">
      <v-list-item v-bind="props">
        <template #prepend>
          <v-icon :color="getCohortColor(item.raw.name)" size="small">mdi-tag</v-icon>
        </template>
      </v-list-item>
    </template>
    <template #no-data>
      <v-list-item>
        <v-list-item-title class="text-grey text-body-2">
          Type to create a new cohort
        </v-list-item-title>
      </v-list-item>
    </template>
  </v-combobox>
</template>

<script setup lang="ts">
import { getCohortColor } from '../composables/useCaseMetadata'
import type { CohortGroup } from '../../../shared/types/api'

defineProps<{
  modelValue: CohortGroup[]
  availableCohorts: CohortGroup[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [cohorts: CohortGroup[]]
  'create:cohort': [name: string]
}>()

function handleSelectionChange(newValue: (CohortGroup | string)[]): void {
  // Separate existing cohorts from new names (strings)
  const existingCohorts: CohortGroup[] = []
  const newNames: string[] = []

  for (const item of newValue) {
    if (typeof item === 'string') {
      // User typed a new name
      newNames.push(item.trim())
    } else {
      existingCohorts.push(item)
    }
  }

  // Emit create event for each new name
  for (const name of newNames) {
    if (name.length > 0) {
      emit('create:cohort', name)
    }
  }

  // Emit update with existing cohorts (parent handles adding newly created ones)
  emit('update:modelValue', existingCohorts)
}
</script>
