<template>
  <v-dialog v-model="dialogOpen" max-width="400">
    <v-card>
      <v-card-title>Change Database Password</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="newPassword"
          label="New Password"
          :type="showNewPassword ? 'text' : 'password'"
          :append-inner-icon="showNewPassword ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append-inner="showNewPassword = !showNewPassword"
        />

        <v-text-field
          v-model="confirmPassword"
          label="Confirm New Password"
          :type="showConfirmPassword ? 'text' : 'password'"
          :append-inner-icon="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
          :error-messages="passwordError"
          @click:append-inner="showConfirmPassword = !showConfirmPassword"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancel">Cancel</v-btn>
        <v-btn color="primary" :loading="submitting" @click="submit">Change Password</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useDatabaseStore } from '../stores/databaseStore'

const databaseStore = useDatabaseStore()

// Component state
const dialogOpen = ref(false)
const newPassword = ref('')
const confirmPassword = ref('')
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const submitting = ref(false)
const passwordError = ref('')

// Emits
const emit = defineEmits<{
  'password-changed': []
}>()

// Exposed methods
function show(): void {
  newPassword.value = ''
  confirmPassword.value = ''
  showNewPassword.value = false
  showConfirmPassword.value = false
  submitting.value = false
  passwordError.value = ''
  dialogOpen.value = true
}

function hide(): void {
  dialogOpen.value = false
}

function validate(): boolean {
  passwordError.value = ''

  if (newPassword.value.length === 0) {
    passwordError.value = 'Password is required'
    return false
  }

  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'Passwords do not match'
    return false
  }

  return true
}

async function submit(): Promise<void> {
  if (!validate()) return

  submitting.value = true

  try {
    const result = await databaseStore.changePassword(newPassword.value)

    if (result.success) {
      hide()
      emit('password-changed')
    } else {
      passwordError.value = result.error ?? 'Failed to change password'
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
