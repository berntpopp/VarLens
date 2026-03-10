<template>
  <div>
    <div class="text-body-medium mb-4">This archive is password-protected.</div>
    <v-text-field
      :model-value="zipPassword"
      label="Password"
      :type="showZipPassword ? 'text' : 'password'"
      :append-inner-icon="showZipPassword ? 'mdi-eye-off' : 'mdi-eye'"
      :error-messages="zipErrorMessage"
      autofocus
      @update:model-value="$emit('update:zipPassword', $event)"
      @click:append-inner="$emit('update:showZipPassword', !showZipPassword)"
      @keyup.enter="$emit('unlock')"
    />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  zipPassword: string
  showZipPassword: boolean
  zipErrorMessage: string
}>()

defineEmits<{
  'update:zipPassword': [value: string]
  'update:showZipPassword': [value: boolean]
  unlock: []
}>()
</script>
