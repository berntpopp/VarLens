<template>
  <div>
    <v-text-field
      :model-value="stripText"
      label="Remove from names"
      placeholder="e.g. _results, LB24-"
      variant="outlined"
      density="compact"
      clearable
      hide-details
      class="mb-3"
      prepend-inner-icon="mdi-text-search-variant"
      @update:model-value="$emit('update:stripText', $event)"
    />

    <v-alert v-if="duplicateCount > 0" type="warning" variant="tonal" class="mb-3">
      {{ duplicateCount }} of {{ fileCount }} files already exist as cases.
    </v-alert>

    <div v-if="duplicateCount > 0">
      <v-radio-group
        :model-value="duplicateStrategy"
        class="mb-3"
        hide-details
        @update:model-value="$emit('update:duplicateStrategy', $event as DuplicateChoice)"
      >
        <v-radio value="skip" color="primary">
          <template #label>
            <div>
              <strong>Skip duplicates</strong>
              <div class="text-body-small text-medium-emphasis">
                Only import new files, leave existing cases unchanged
              </div>
            </div>
          </template>
        </v-radio>
        <v-radio value="overwrite" color="warning">
          <template #label>
            <div>
              <strong>Overwrite duplicates</strong>
              <div class="text-body-small text-medium-emphasis">
                Replace existing cases with data from the selected files
              </div>
            </div>
          </template>
        </v-radio>
      </v-radio-group>
      <v-divider class="mb-3" />
    </div>

    <div class="text-body-small text-medium-emphasis mb-2">
      {{ fileCount }} file{{ fileCount !== 1 ? 's' : '' }} to import:
    </div>
    <v-list density="compact" class="pa-0" max-height="300" style="overflow-y: auto">
      <v-list-item
        v-for="(file, i) in reviewFiles"
        :key="i"
        :class="file.isDuplicate ? 'text-warning' : ''"
      >
        <template #prepend>
          <v-icon v-if="file.isDuplicate" color="warning" size="small">
            mdi-alert-circle-outline
          </v-icon>
          <v-icon v-else color="success" size="small"> mdi-new-box </v-icon>
        </template>
        <v-list-item-title class="text-body-medium">
          {{ file.caseName }}
          <span v-if="file.isDuplicate" class="text-body-small text-warning ml-1"> (exists) </span>
        </v-list-item-title>
        <v-list-item-subtitle v-if="file.caseName !== file.fileName" class="text-body-small">
          {{ file.fileName }}
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>

    <v-alert v-if="hasEmptyCaseNames" type="error" variant="tonal" density="compact" class="mt-3">
      Some case names are empty after stripping. Adjust the text to remove.
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import type { DuplicateChoice } from '../../../../shared/types/api'

defineProps<{
  reviewFiles: Array<{ caseName: string; fileName: string; isDuplicate: boolean }>
  fileCount: number
  duplicateCount: number
  duplicateStrategy: DuplicateChoice
  stripText: string
  hasEmptyCaseNames: boolean
}>()

defineEmits<{
  'update:duplicateStrategy': [value: DuplicateChoice]
  'update:stripText': [value: string | null]
}>()
</script>
