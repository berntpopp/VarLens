<template>
  <v-dialog v-model="dialog" max-width="400">
    <v-card>
      <v-card-title>Delete Case?</v-card-title>
      <v-card-text>
        Delete "{{ caseName }}"? This will remove all {{ variantCount.toLocaleString() }} variants.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancel">Cancel</v-btn>
        <v-btn color="error" @click="confirm">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const dialog = ref(false)
const caseName = ref('')
const variantCount = ref(0)
let resolvePromise: ((value: boolean) => void) | null = null

const show = (name: string, count: number): Promise<boolean> => {
  caseName.value = name
  variantCount.value = count
  dialog.value = true

  return new Promise((resolve) => {
    resolvePromise = resolve
  })
}

const confirm = (): void => {
  dialog.value = false
  resolvePromise?.(true)
  resolvePromise = null
}

const cancel = (): void => {
  dialog.value = false
  resolvePromise?.(false)
  resolvePromise = null
}

defineExpose({ show })
</script>
