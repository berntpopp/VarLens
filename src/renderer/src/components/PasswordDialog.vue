<template>
  <v-dialog v-model="dialogOpen" max-width="400" persistent>
    <v-card>
      <v-card-title>Enter Database Password</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="password"
          label="Password"
          :type="showPassword ? 'text' : 'password'"
          :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          :error-messages="errorMessage"
          autofocus
          @click:append-inner="showPassword = !showPassword"
          @keyup.enter="submit"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancel">Cancel</v-btn>
        <v-btn color="primary" :loading="submitting" @click="submit">OK</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'

// Component state
const dialogOpen = ref(false)
const password = ref('')
const showPassword = ref(false)
const errorMessage = ref('')
const submitting = ref(false)

// Callback stored when dialog is shown
let onSubmitCallback: ((password: string) => Promise<{ success: boolean; error?: string }>) | null =
  null

// Exposed methods
function show(onSubmit: (password: string) => Promise<{ success: boolean; error?: string }>): void {
  password.value = ''
  showPassword.value = false
  errorMessage.value = ''
  submitting.value = false
  onSubmitCallback = onSubmit
  dialogOpen.value = true
}

function hide(): void {
  dialogOpen.value = false
  onSubmitCallback = null
}

async function submit(): Promise<void> {
  if (onSubmitCallback === null) return

  submitting.value = true
  errorMessage.value = ''

  try {
    const result = await onSubmitCallback(password.value)
    if (result.success) {
      hide()
    } else if (result.error === 'WRONG_PASSWORD') {
      errorMessage.value = 'Incorrect password. Please try again.'
    } else {
      errorMessage.value = result.error ?? 'Failed to unlock database'
    }
  } finally {
    submitting.value = false
  }
}

function cancel(): void {
  hide()
}

defineExpose({
  show,
  hide
})
</script>
