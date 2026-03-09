<template>
  <v-snackbar v-model="snackbar" :color="color" :timeout="timeout" location="bottom right">
    {{ message }}
    <template #actions>
      <v-btn v-if="actionText" variant="text" @click="handleAction">{{ actionText }}</v-btn>
      <v-btn variant="text" @click="snackbar = false">Close</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { APP_CONFIG } from '../../../shared/config'

const snackbar = ref(false)
const message = ref('')
const color = ref<'success' | 'error'>('success')
const timeout = ref<number>(APP_CONFIG.SNACKBAR_SUCCESS_MS)
const actionText = ref<string | null>(null)
const actionCallback = ref<(() => void) | null>(null)

interface ShowOptions {
  action?: {
    text: string
    callback: () => void
  }
  timeout?: number
}

const show = (msg: string, type: 'success' | 'error' = 'success', options?: ShowOptions): void => {
  message.value = msg
  color.value = type
  timeout.value =
    options?.timeout ??
    (type === 'error' ? APP_CONFIG.SNACKBAR_ERROR_MS : APP_CONFIG.SNACKBAR_SUCCESS_MS)
  actionText.value = options?.action?.text ?? null
  actionCallback.value = options?.action?.callback ?? null
  snackbar.value = true
}

const handleAction = (): void => {
  if (actionCallback.value) {
    actionCallback.value()
  }
}

defineExpose({ show })
</script>
