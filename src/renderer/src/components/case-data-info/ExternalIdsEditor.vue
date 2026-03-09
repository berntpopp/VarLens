<template>
  <div class="text-subtitle-2 text-medium-emphasis mb-2">
    <v-icon size="small" class="mr-1">mdi-identifier</v-icon>
    External IDs
  </div>
  <v-table v-if="externalIds.length > 0" density="compact" class="mb-2">
    <tbody>
      <tr v-for="extId in externalIds" :key="extId.id_type">
        <td style="width: 40%">
          <span class="text-body-2 font-weight-medium">{{ extId.id_type }}</span>
        </td>
        <td>
          <span class="text-body-2">{{ extId.id_value }}</span>
        </td>
        <td style="width: 40px">
          <v-btn
            icon="mdi-delete-outline"
            size="x-small"
            variant="text"
            color="error"
            @click="$emit('delete', extId.id_type)"
          />
        </td>
      </tr>
    </tbody>
  </v-table>
  <div v-else class="text-body-2 text-medium-emphasis mb-2">No external IDs added yet</div>
  <v-row dense class="mb-4">
    <v-col cols="5">
      <v-combobox
        v-model="newIdType"
        label="ID type"
        :items="idTypeSuggestions"
        density="compact"
        variant="outlined"
        hide-details
        placeholder="Type or select..."
      />
    </v-col>
    <v-col cols="5">
      <v-text-field
        v-model="newIdValue"
        label="Value"
        density="compact"
        variant="outlined"
        hide-details
        placeholder="e.g. S-12345"
        @keydown.enter="handleAdd"
      />
    </v-col>
    <v-col cols="2" class="d-flex align-center">
      <v-btn color="primary" size="small" :disabled="!newIdType || !newIdValue" @click="handleAdd">
        Add
      </v-btn>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface ExternalId {
  id_type: string
  id_value: string
}

defineProps<{
  externalIds: ExternalId[]
  idTypeSuggestions: string[]
}>()

const emit = defineEmits<{
  add: [idType: string, idValue: string]
  delete: [idType: string]
}>()

const newIdType = ref('')
const newIdValue = ref('')

function handleAdd(): void {
  const type = typeof newIdType.value === 'string' ? newIdType.value.trim() : ''
  const value = newIdValue.value.trim()
  if (type === '' || value === '') return

  emit('add', type, value)
  newIdType.value = ''
  newIdValue.value = ''
}
</script>
