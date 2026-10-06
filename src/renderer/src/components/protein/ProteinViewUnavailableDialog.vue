<template>
  <v-dialog
    :model-value="modelValue"
    max-width="460"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-title-medium">Protein view not available in web mode</v-card-title>
      <v-card-text>
        The protein structure, domain, and ClinVar lollipop views rely on external annotation
        services that the web server does not provide yet. Open this variant in the VarLens desktop
        app to use them.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:modelValue', false)">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean }>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()
</script>
