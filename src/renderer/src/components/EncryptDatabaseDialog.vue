<template>
  <v-dialog v-model="dialogOpen" max-width="480" :persistent="submitting">
    <v-card>
      <template v-if="phase === 'consent'">
        <v-card-title>Encrypt This Database?</v-card-title>
        <v-card-text>
          <p class="mb-4">
            VarLens will convert <strong>{{ databaseStore.currentName }}</strong> to an
            encrypted-at-rest database. A plaintext backup is kept on disk until you confirm the
            encrypted database opens correctly, so this is fully reversible.
          </p>

          <v-checkbox
            v-model="consent"
            label="I understand and want to encrypt this database"
            color="primary"
            hide-details
          />

          <v-alert
            v-if="!keyringAvailable"
            type="warning"
            variant="tonal"
            density="compact"
            class="mt-4"
          >
            Secure key storage isn't available on this system. A recovery passphrase is required to
            encrypt this database -- without it, VarLens cannot proceed.
          </v-alert>

          <v-checkbox
            v-if="keyringAvailable"
            v-model="setRecoveryPassphrase"
            label="Also set a recovery passphrase (recommended)"
            hint="If you ever lose access to this system's secure key storage, only a recovery passphrase can unlock this database again."
            persistent-hint
            color="primary"
            class="mt-2"
          />

          <v-expand-transition>
            <div v-if="!keyringAvailable || setRecoveryPassphrase">
              <v-text-field
                v-model="recoveryPassphrase"
                label="Recovery Passphrase"
                :type="showPassphrase ? 'text' : 'password'"
                :append-inner-icon="showPassphrase ? mdiEyeOff : mdiEye"
                :error-messages="passphraseError"
                class="mt-2"
                @click:append-inner="showPassphrase = !showPassphrase"
              />
              <v-text-field
                v-model="confirmPassphrase"
                label="Confirm Recovery Passphrase"
                :type="showPassphrase ? 'text' : 'password'"
              />
            </div>
          </v-expand-transition>

          <v-alert v-if="submitError" type="error" variant="tonal" density="compact" class="mt-4">
            {{ submitError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="submitting" @click="cancel">Cancel</v-btn>
          <v-btn color="primary" :loading="submitting" :disabled="!consent" @click="submit">
            Encrypt Database
          </v-btn>
        </v-card-actions>
      </template>

      <template v-else>
        <v-card-title>Database Encrypted</v-card-title>
        <v-card-text>
          <v-alert type="success" variant="tonal" density="compact" class="mb-4">
            The database is now encrypted at rest.
          </v-alert>

          <v-alert
            v-if="!recoveryPassphraseSet"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <p class="mb-2">
              No recovery passphrase is set on this key. If this system's secure key storage is ever
              lost, this database cannot be recovered.
            </p>
            <v-btn variant="tonal" color="warning" size="small" @click="requestRecoveryPassphrase">
              Set Recovery Passphrase Now
            </v-btn>
          </v-alert>

          <v-alert
            v-else-if="recoverySidecarWritten === false"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-4"
          >
            <p class="mb-2">
              The recovery passphrase was saved locally, but the portable recovery file could not be
              written. Do not move this database or remove this system's key storage yet.
            </p>
            <v-btn variant="tonal" color="warning" size="small" @click="requestRecoveryPassphrase">
              Retry Portable Recovery Setup
            </v-btn>
          </v-alert>

          <p class="mb-2">A plaintext backup of the original, unencrypted database was kept at:</p>
          <p class="text-body-small mb-4" style="word-break: break-all">{{ backupPath }}</p>
          <p>
            This backup contains your data <strong>unencrypted</strong>. Once you've confirmed
            everything looks right, delete it.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="deletingBackup" @click="keepBackup">Keep Backup</v-btn>
          <v-btn color="error" :loading="deletingBackup" @click="removeBackup">
            Delete Plaintext Backup
          </v-btn>
        </v-card-actions>
      </template>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useDatabaseStore } from '../stores/databaseStore'
import { isIpcError } from '../../../shared/types/errors'
import { mdiEye, mdiEyeOff } from '@mdi/js'

const databaseStore = useDatabaseStore()

type Phase = 'consent' | 'success'

// Component state
const dialogOpen = ref(false)
const phase = ref<Phase>('consent')
const keyringAvailable = ref(true)
const consent = ref(false)
const setRecoveryPassphrase = ref(false)
const recoveryPassphrase = ref('')
const confirmPassphrase = ref('')
const showPassphrase = ref(false)
const passphraseError = ref('')
const submitError = ref('')
const submitting = ref(false)
const deletingBackup = ref(false)
const backupPath = ref('')
const recoveryPassphraseSet = ref(false)
const recoverySidecarWritten = ref<boolean | undefined>()

// Emits
const emit = defineEmits<{
  'database-migrated': []
  'request-recovery-passphrase': []
  error: [message: string]
}>()

/**
 * `keyringAvailable` is a best-effort UI hint, not an authority check -- the
 * main process makes the actual keyring-vs-passphrase decision and returns a
 * typed error if a passphrase is required but missing. Callers should pass
 * `databaseStore.capabilities?.workspace.encryptionAtRest` or similar if a
 * cheap client-side signal exists; otherwise this defaults to true (the
 * common case) and lets the submit-time error surface the real requirement.
 */
function show(options: { keyringAvailable?: boolean } = {}): void {
  phase.value = 'consent'
  keyringAvailable.value = options.keyringAvailable ?? true
  consent.value = false
  setRecoveryPassphrase.value = false
  recoveryPassphrase.value = ''
  confirmPassphrase.value = ''
  showPassphrase.value = false
  passphraseError.value = ''
  submitError.value = ''
  submitting.value = false
  deletingBackup.value = false
  backupPath.value = ''
  recoveryPassphraseSet.value = false
  recoverySidecarWritten.value = undefined
  dialogOpen.value = true
}

function hide(): void {
  dialogOpen.value = false
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
}

function validatePassphrase(): boolean {
  passphraseError.value = ''
  const needsPassphrase = !keyringAvailable.value || setRecoveryPassphrase.value
  if (!needsPassphrase) {
    return true
  }
  if (recoveryPassphrase.value.length === 0) {
    passphraseError.value = 'A recovery passphrase is required'
    return false
  }
  if (recoveryPassphrase.value !== confirmPassphrase.value) {
    passphraseError.value = 'Passphrases do not match'
    return false
  }
  return true
}

async function submit(): Promise<void> {
  submitError.value = ''
  if (!consent.value || !validatePassphrase()) {
    return
  }

  submitting.value = true
  try {
    const result = await databaseStore.migrateToEncrypted({
      consent: true,
      recoveryPassphrase: recoveryPassphrase.value.length > 0 ? recoveryPassphrase.value : undefined
    })

    if (result.success) {
      backupPath.value = result.backupPath ?? ''
      recoveryPassphraseSet.value = result.recoveryPassphraseSet ?? false
      recoverySidecarWritten.value = result.sidecarWritten
      phase.value = 'success'
    } else {
      submitError.value = result.error ?? 'Failed to encrypt database'
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

/**
 * Opens `SetRecoveryPassphraseDialog` on top of this one (owned by
 * `DatabasePicker.vue`, which handles the emit) rather than closing this
 * dialog first -- the plaintext-backup decision below is still pending and
 * should not be lost just because the user set a passphrase first.
 */
function requestRecoveryPassphrase(): void {
  emit('request-recovery-passphrase')
}

function keepBackup(): void {
  hide()
  emit('database-migrated')
}

async function removeBackup(): Promise<void> {
  if (backupPath.value === '') {
    keepBackup()
    return
  }
  deletingBackup.value = true
  try {
    await databaseStore.deletePlaintextBackup(backupPath.value)
    hide()
    emit('database-migrated')
  } catch (e) {
    emit('error', errorText(e))
  } finally {
    deletingBackup.value = false
  }
}

defineExpose({
  show,
  hide
})
</script>
