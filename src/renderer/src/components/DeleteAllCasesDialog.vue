<template>
  <v-dialog v-model="dialog" max-width="450" persistent>
    <v-card>
      <v-card-title class="text-error">Delete All Cases?</v-card-title>
      <v-card-text>
        <v-alert type="warning" variant="tonal" class="mb-4">
          This action cannot be undone.
        </v-alert>
        <p class="mb-4">
          This will permanently delete <strong>{{ caseCount }}</strong>
          {{ caseCount === 1 ? 'case' : 'cases' }} and all their variants.
        </p>
        <p class="text-body-2 mb-2">Type <strong>DELETE</strong> to confirm:</p>
        <v-text-field
          v-model="confirmText"
          density="compact"
          variant="outlined"
          placeholder="DELETE"
          hide-details
          @keyup.enter="confirmText === 'DELETE' && confirm()"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancel">Cancel</v-btn>
        <v-btn color="error" :disabled="confirmText !== 'DELETE'" @click="confirm">
          Delete All
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const dialog = ref(false)
const caseCount = ref(0)
const confirmText = ref('')
let resolvePromise: ((value: boolean) => void) | null = null

const show = (count: number): Promise<boolean> => {
  caseCount.value = count
  confirmText.value = ''
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
