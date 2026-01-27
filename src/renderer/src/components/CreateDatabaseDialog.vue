<template>
  <v-dialog v-model="dialogOpen" max-width="500">
    <v-card>
      <v-card-title>Create New Database</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="databaseName"
          label="Database Name"
          hint="File will be saved as name.sqlite"
          :error-messages="nameError"
          @keyup.enter="selectLocation"
        />

        <v-checkbox v-model="encrypt" label="Encrypt with password" color="primary" class="mt-2" />

        <v-expand-transition>
          <div v-if="encrypt">
            <v-text-field
              v-model="password"
              label="Password"
              :type="showPassword ? 'text' : 'password'"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              class="mt-2"
              @click:append-inner="showPassword = !showPassword"
            />

            <v-text-field
              v-model="confirmPassword"
              label="Confirm Password"
              :type="showConfirmPassword ? 'text' : 'password'"
              :append-inner-icon="showConfirmPassword ? 'mdi-eye-off' : 'mdi-eye'"
              :error-messages="passwordError"
              @click:append-inner="showConfirmPassword = !showConfirmPassword"
            />
          </div>
        </v-expand-transition>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="cancel">Cancel</v-btn>
        <v-btn color="primary" :loading="creating" @click="selectLocation">Create</v-btn>
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
const databaseName = ref('')
const encrypt = ref(false)
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const creating = ref(false)
const nameError = ref('')
const passwordError = ref('')

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
  dialogOpen.value = true
}

function hide(): void {
  dialogOpen.value = false
}

function validate(): boolean {
  nameError.value = ''
  passwordError.value = ''

  if (!databaseName.value.trim()) {
    nameError.value = 'Database name is required'
    return false
  }

  if (encrypt.value) {
    if (password.value.length === 0) {
      passwordError.value = 'Password is required'
      return false
    }
    if (password.value !== confirmPassword.value) {
      passwordError.value = 'Passwords do not match'
      return false
    }
  }

  return true
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
