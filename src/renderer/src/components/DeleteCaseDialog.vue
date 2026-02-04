<template>
  <v-dialog v-model="dialog" max-width="400">
    <v-card>
      <v-card-title>{{ isBatchMode ? 'Delete Cases?' : 'Delete Case?' }}</v-card-title>
      <v-card-text>
        <template v-if="isBatchMode">
          Delete {{ caseCount }} {{ caseCount === 1 ? 'case' : 'cases' }}? This will remove all
          {{ variantCount.toLocaleString() }} variants.
        </template>
        <template v-else>
          Delete "{{ caseName }}"? This will remove all
          {{ variantCount.toLocaleString() }} variants.
        </template>
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
const isBatchMode = ref(false)
const caseCount = ref(0)
let resolvePromise: ((value: boolean) => void) | null = null

const show = (name: string, count: number): Promise<boolean> => {
  caseName.value = name
  variantCount.value = count
  isBatchMode.value = false
  caseCount.value = 1
  dialog.value = true

  return new Promise((resolve) => {
    resolvePromise = resolve
  })
}

const showBatch = (cases: number, variants: number): Promise<boolean> => {
  caseCount.value = cases
  variantCount.value = variants
  isBatchMode.value = true
  caseName.value = ''
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

defineExpose({ show, showBatch })
</script>
