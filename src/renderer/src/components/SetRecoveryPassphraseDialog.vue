<template>
  <v-dialog v-model="dialogOpen" max-width="440">
    <v-card>
      <v-card-title>Set Recovery Passphrase</v-card-title>
      <v-card-text>
        <p class="mb-4">
          This does <strong>not</strong> change your database password and does
          <strong>not</strong> re-encrypt anything. It adds a portable way to recover this database
          if you ever lose access to this system's secure key storage, or want to open it on another
          machine. VarLens writes a small <code>.varlens-recovery.json</code> file next to the
          database file.
        </p>

        <v-text-field
          v-model="passphrase"
          label="Recovery Passphrase"
          :type="showPassphrase ? 'text' : 'password'"
          :append-inner-icon="showPassphrase ? mdiEyeOff : mdiEye"
          @click:append-inner="showPassphrase = !showPassphrase"
        />

        <v-text-field
          v-model="confirmPassphrase"
          label="Confirm Recovery Passphrase"
          :type="showPassphrase ? 'text' : 'password'"
          :error-messages="passphraseError"
        />

        <v-alert v-if="submitError" type="error" variant="tonal" density="compact" class="mt-4">
          {{ submitError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="submitting" @click="cancel">Cancel</v-btn>
        <v-btn color="primary" :loading="submitting" @click="submit">
          Set Recovery Passphrase
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useDatabaseStore } from '../stores/databaseStore'
import { isIpcError } from '../../../shared/types/errors'
import { mdiEye, mdiEyeOff } from '@mdi/js'

const databaseStore = useDatabaseStore()

// Component state
const dialogOpen = ref(false)
const passphrase = ref('')
const confirmPassphrase = ref('')
const showPassphrase = ref(false)
const submitting = ref(false)
const passphraseError = ref('')
const submitError = ref('')

// Emits
const emit = defineEmits<{
  'recovery-passphrase-set': []
}>()

// Exposed methods
function show(): void {
  passphrase.value = ''
  confirmPassphrase.value = ''
  showPassphrase.value = false
  submitting.value = false
  passphraseError.value = ''
  submitError.value = ''
  dialogOpen.value = true
}

function hide(): void {
  dialogOpen.value = false
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
}

function validate(): boolean {
  passphraseError.value = ''

  if (passphrase.value.length === 0) {
    passphraseError.value = 'A recovery passphrase is required'
    return false
  }

  if (passphrase.value !== confirmPassphrase.value) {
    passphraseError.value = 'Passphrases do not match'
    return false
  }

  return true
}

async function submit(): Promise<void> {
  submitError.value = ''
  if (!validate()) return

  submitting.value = true
  try {
    const result = await databaseStore.setRecoveryPassphrase(passphrase.value)
    if (result.success && result.sidecarWritten !== false) {
      hide()
      emit('recovery-passphrase-set')
    } else if (result.success) {
      submitError.value =
        'The passphrase was updated locally, but writing the portable recovery file failed. ' +
        'Check the database directory permissions and try again.'
    } else {
      submitError.value = result.error ?? 'Failed to set recovery passphrase'
    }
  } catch (e) {
    submitError.value = errorText(e)
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
