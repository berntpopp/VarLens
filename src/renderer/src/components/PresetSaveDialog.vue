<template>
  <v-dialog
    :model-value="modelValue"
    max-width="400"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h6">Save Filter Preset</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          label="Preset name"
          variant="outlined"
          density="compact"
          :rules="[rules.required, rules.maxLength]"
          :error-messages="errorMessage"
          autofocus
          class="mb-2"
        />
        <v-textarea
          v-model="description"
          label="Description (optional)"
          variant="outlined"
          density="compact"
          rows="2"
          hide-details
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="!name.trim()"
          @click="save"
        >
          Save
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  modelValue: boolean
  /** Driven by parent — true while the API call is in flight */
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [data: { name: string; description: string | null }]
}>()

const name = ref('')
const description = ref('')
const errorMessage = ref('')

const rules = {
  required: (v: string) => !!v.trim() || 'Name is required',
  maxLength: (v: string) => v.length <= 100 || 'Max 100 characters'
}

function save(): void {
  if (!name.value.trim()) return
  errorMessage.value = ''
  emit('save', {
    name: name.value.trim(),
    description: description.value.trim() || null
  })
  name.value = ''
  description.value = ''
}
</script>
