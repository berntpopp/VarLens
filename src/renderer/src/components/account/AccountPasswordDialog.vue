<template>
  <v-dialog v-model="open" max-width="420">
    <v-card>
      <v-card-title>Change your password</v-card-title>
      <v-card-text>
        <v-form @submit.prevent="submit">
          <v-text-field
            v-model="oldPassword"
            type="password"
            label="Current password"
            autocomplete="current-password"
            class="mb-2"
          />
          <v-text-field
            v-model="newPassword"
            type="password"
            label="New password"
            autocomplete="new-password"
            hint="At least 12 characters and different from the current one."
            persistent-hint
            class="mb-2"
          />
          <v-text-field
            v-model="confirmPassword"
            type="password"
            label="Confirm new password"
            autocomplete="new-password"
            :error-messages="mismatch ? 'Passwords do not match' : ''"
            class="mb-2"
          />
          <v-alert v-if="error" type="error" variant="tonal" role="alert" class="mb-3">
            {{ error }}
          </v-alert>
          <v-btn
            type="submit"
            color="primary"
            block
            :loading="busy"
            :disabled="!oldPassword || !newPassword || mismatch"
          >
            Change password
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useApiService } from '../../composables/useApiService'
import { describeAdminError } from '../../composables/useUserAdmin'
import { unwrapIpcResult } from '../../../../shared/types/errors'

const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ changed: [] }>()
const { api } = useApiService()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const busy = ref(false)
const error = ref('')
const mismatch = computed(
  () => confirmPassword.value !== '' && confirmPassword.value !== newPassword.value
)

watch(open, (isOpen) => {
  if (!isOpen) return
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  error.value = ''
})

async function submit(): Promise<void> {
  if (!api || mismatch.value) return
  busy.value = true
  error.value = ''
  try {
    unwrapIpcResult(await api.auth.changePassword(oldPassword.value, newPassword.value))
    open.value = false
    emit('changed')
  } catch (e) {
    error.value = describeAdminError(e, 'Failed to change password')
  } finally {
    busy.value = false
  }
}
</script>
