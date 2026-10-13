<script setup lang="ts">
/**
 * Read-only list of the annotation fields this case's import kept as
 * `info.<KEY>`, with their original source fields (#596).
 */
import { computed } from 'vue'
import { mdiTableColumn } from '@mdi/js'
import { caseInfoFields } from '../../../../shared/utils/case-info-fields'

const props = defineProps<{ fieldDictionary: string | null | undefined }>()

const fields = computed(() => caseInfoFields(props.fieldDictionary))
</script>

<template>
  <div class="mb-4" data-testid="kept-fields-list">
    <div class="text-subtitle-2 text-medium-emphasis mb-2">
      <v-icon size="small" class="mr-1" :icon="mdiTableColumn" />
      Kept annotation fields ({{ fields.length }})
    </div>
    <v-table v-if="fields.length > 0" density="compact" fixed-header height="200">
      <thead>
        <tr>
          <th>Filter key</th>
          <th>Source field</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="field in fields" :key="field.key">
          <td class="kept-field-key">info.{{ field.key }}</td>
          <td>{{ field.source }}</td>
        </tr>
      </tbody>
    </v-table>
    <div v-else class="text-body-small text-medium-emphasis">
      No field sources recorded: the import kept no extra fields, or the case was imported before
      VarLens recorded them.
    </div>
  </div>
</template>

<style scoped>
.kept-field-key {
  font-family: var(--font-mono);
}
</style>
