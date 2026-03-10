<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '../stores/authStore'
import { useApiService } from '../composables/useApiService'

const authStore = useAuthStore()
const { api } = useApiService()

const username = ref('')
const password = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')
const mustChangePassword = ref(false)

async function handleLogin(): Promise<void> {
  if (!username.value || !password.value) return

  loading.value = true
  error.value = ''

  try {
    const result = await authStore.login(username.value, password.value)
    if (result.success) {
      if (result.mustChangePassword === true) {
        mustChangePassword.value = true
      }
    } else if (result.locked === true) {
      error.value = 'Account is temporarily locked. Please try again later.'
    } else {
      error.value = 'Invalid username or password.'
    }
  } catch {
    error.value = 'Login failed. Please try again.'
  } finally {
    loading.value = false
  }
}

async function handleChangePassword(): Promise<void> {
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'Passwords do not match.'
    return
  }
  if (newPassword.value.length < 8) {
    error.value = 'Password must be at least 8 characters.'
    return
  }

  loading.value = true
  error.value = ''

  if (!api) return

  try {
    await api.auth.changePassword(password.value, newPassword.value)
    mustChangePassword.value = false
  } catch {
    error.value = 'Failed to change password.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <v-container class="fill-height" fluid>
    <v-row align="center" justify="center">
      <v-col cols="12" sm="8" md="4">
        <v-card class="elevation-4">
          <v-card-title class="text-h5 text-center pt-6"> VarLens </v-card-title>
          <v-card-subtitle class="text-center">
            {{ mustChangePassword ? 'Change your password' : 'Sign in to continue' }}
          </v-card-subtitle>

          <v-card-text class="pt-4">
            <v-alert
              v-if="error"
              type="error"
              variant="tonal"
              class="mb-4"
              closable
              @click:close="error = ''"
            >
              {{ error }}
            </v-alert>

            <!-- Login Form -->
            <v-form v-if="!mustChangePassword" @submit.prevent="handleLogin">
              <v-text-field
                v-model="username"
                label="Username"
                prepend-inner-icon="mdi-account"
                variant="outlined"
                density="comfortable"
                autofocus
                class="mb-2"
              />
              <v-text-field
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                label="Password"
                prepend-inner-icon="mdi-lock"
                :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
                variant="outlined"
                density="comfortable"
                class="mb-4"
                @click:append-inner="showPassword = !showPassword"
              />
              <v-btn
                type="submit"
                color="primary"
                block
                size="large"
                :loading="loading"
                :disabled="!username || !password"
              >
                Sign In
              </v-btn>
            </v-form>

            <!-- Change Password Form -->
            <v-form v-else @submit.prevent="handleChangePassword">
              <v-alert type="info" variant="tonal" class="mb-4">
                You must change your password before continuing.
              </v-alert>
              <v-text-field
                v-model="newPassword"
                type="password"
                label="New Password"
                prepend-inner-icon="mdi-lock-reset"
                variant="outlined"
                density="comfortable"
                hint="Minimum 8 characters"
                class="mb-2"
              />
              <v-text-field
                v-model="confirmPassword"
                type="password"
                label="Confirm New Password"
                prepend-inner-icon="mdi-lock-check"
                variant="outlined"
                density="comfortable"
                class="mb-4"
              />
              <v-btn
                type="submit"
                color="primary"
                block
                size="large"
                :loading="loading"
                :disabled="!newPassword || !confirmPassword"
              >
                Change Password
              </v-btn>
            </v-form>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
