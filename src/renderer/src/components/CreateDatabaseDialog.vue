<template>
  <v-dialog v-model="dialogOpen" max-width="500">
    <v-card>
      <v-card-title>{{
        needsPassphraseSetup ? 'Set a Database Password' : 'Create New Database'
      }}</v-card-title>
      <v-card-text>
        <v-alert v-if="needsPassphraseSetup" type="info" variant="tonal" class="mb-4">
          Secure key storage isn't available on this system, so VarLens can't encrypt this database
          automatically. Choose a password to protect it instead.
        </v-alert>

        <template v-if="!needsPassphraseSetup">
          <v-text-field
            v-model="databaseName"
            label="Database Name"
            hint="File will be saved as name.sqlite"
            :error-messages="nameError"
            @keyup.enter="selectLocation"
          />

          <v-checkbox
            v-model="encrypt"
            label="Encrypt with a custom password"
            hint="Leave unchecked to encrypt automatically with a managed key"
            persistent-hint
            color="primary"
            class="mt-2"
          />
        </template>

        <v-expand-transition>
          <div v-if="encrypt || needsPassphraseSetup">
            <v-text-field
              v-model="password"
              label="Password"
              :type="showPassword ? 'text' : 'password'"
              :append-inner-icon="showPassword ? mdiEyeOff : mdiEye"
              class="mt-2"
              @click:append-inner="showPassword = !showPassword"
            />

            <v-text-field
              v-model="confirmPassword"
              label="Confirm Password"
              :type="showConfirmPassword ? 'text' : 'password'"
              :append-inner-icon="showConfirmPassword ? mdiEyeOff : mdiEye"
              :error-messages="passwordError"
              @click:append-inner="showConfirmPassword = !showConfirmPassword"
            />
          </div>
        </v-expand-transition>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancel">Cancel</v-btn>
        <v-btn color="primary" :loading="creating" @click="submit">
          {{ needsPassphraseSetup ? 'Set Password' : 'Create' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useDatabaseStore } from '../stores/databaseStore'
import { mdiEye, mdiEyeOff } from '@mdi/js'

const databaseStore = useDatabaseStore()

// Component state
const dialogOpen = ref(false)
const databaseName = ref('')
const encrypt = ref(false)
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const creating = ref(false)
const nameError = ref('')
const passwordError = ref('')

// First-run passphrase-setup fallback (safeStorage unavailable on this
// system): the location was already picked on the first attempt, so this
// mode re-uses the SAME password fields and re-submits against `pendingPath`.
const needsPassphraseSetup = ref(false)
const pendingPath = ref<string | null>(null)

// Emits
const emit = defineEmits<{
  'database-created': []
}>()

// Exposed methods
function show(): void {
  databaseName.value = ''
  encrypt.value = false
  password.value = ''
  confirmPassword.value = ''
  showPassword.value = false
  showConfirmPassword.value = false
  creating.value = false
  nameError.value = ''
  passwordError.value = ''
  needsPassphraseSetup.value = false
  pendingPath.value = null
  dialogOpen.value = true
}

function hide(): void {
  dialogOpen.value = false
}

function validatePasswordFields(): boolean {
  passwordError.value = ''

  if (password.value.length === 0) {
    passwordError.value = 'Password is required'
    return false
  }
  if (password.value !== confirmPassword.value) {
    passwordError.value = 'Passwords do not match'
    return false
  }

  return true
}

function validate(): boolean {
  nameError.value = ''
  passwordError.value = ''

  if (!databaseName.value.trim()) {
    nameError.value = 'Database name is required'
    return false
  }

  if (encrypt.value && !validatePasswordFields()) {
    return false
  }

  return true
}

async function submit(): Promise<void> {
  if (needsPassphraseSetup.value) {
    await submitPassphraseSetup()
  } else {
    await selectLocation()
  }
}

async function selectLocation(): Promise<void> {
  if (!validate()) return

  creating.value = true

  try {
    // Select save location
    const fileName = databaseName.value.endsWith('.sqlite')
      ? databaseName.value
      : `${databaseName.value}.sqlite`
    const path = await databaseStore.selectSaveLocation(fileName)

    if (path === null) {
      // User cancelled
      creating.value = false
      return
    }

    // Create database
    const result = await databaseStore.createDatabase(
      path,
      encrypt.value ? password.value : undefined
    )

    if (result.success) {
      hide()
      emit('database-created')
    } else if (result.needsPassphraseSetup === true) {
      pendingPath.value = path
      needsPassphraseSetup.value = true
      password.value = ''
      confirmPassword.value = ''
    } else {
      passwordError.value = result.error ?? 'Failed to create database'
    }
  } finally {
    creating.value = false
  }
}

async function submitPassphraseSetup(): Promise<void> {
  if (pendingPath.value === null || !validatePasswordFields()) return

  creating.value = true

  try {
    const result = await databaseStore.createDatabase(pendingPath.value, undefined, password.value)

    if (result.success) {
      hide()
      emit('database-created')
    } else {
      passwordError.value = result.error ?? 'Failed to create database'
    }
  } finally {
    creating.value = false
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
