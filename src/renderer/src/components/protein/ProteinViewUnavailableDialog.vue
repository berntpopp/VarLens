<template>
  <v-dialog
    :model-value="modelValue"
    max-width="460"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-title-medium">Protein view unavailable</v-card-title>
      <v-card-text data-testid="protein-view-unavailable-reason">
        {{
          reason ??
          'The protein structure, domain, and ClinVar lollipop views need external annotation services that are not available here.'
        }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
/**
 * Shown instead of the protein view when its lookups are off (web: the
 * administrator has not enabled the "Protein view" external lookup).
 */
defineProps<{ modelValue: boolean; reason?: string | null }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>
