<template>
  <v-snackbar v-model="snackbar" :color="color" :timeout="3000" location="bottom right">
    {{ message }}
    <template #actions>
      <v-btn variant="text" @click="snackbar = false">Close</v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const snackbar = ref(false)
const message = ref('')
const color = ref<'success' | 'error'>('success')

const show = (msg: string, type: 'success' | 'error' = 'success'): void => {
  message.value = msg
  color.value = type
  snackbar.value = true
}

defineExpose({ show })
</script>
