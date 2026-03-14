<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/authStore'
import { useApiService } from '../composables/useApiService'

const authStore = useAuthStore()
const { api } = useApiService()

interface UserRow {
  id: number
  username: string
  display_name: string | null
  role: string
  is_active: number
  must_change_password: number
  failed_login_count: number
  created_at: string
}

const users = ref<UserRow[]>([])
const showCreateDialog = ref(false)
const showResetDialog = ref(false)
const selectedUser = ref('')
const loading = ref(false)
const error = ref('')
const success = ref('')

// Create user form
const newUsername = ref('')
const newDisplayName = ref('')
const newTempPassword = ref('')

// Reset password form
const resetPassword = ref('')

async function loadUsers(): Promise<void> {
  try {
    users.value = await api!.auth.listUsers()
  } catch {
    error.value = 'Failed to load users'
  }
}

async function handleCreateUser(): Promise<void> {
  if (!newUsername.value || !newTempPassword.value) return

  loading.value = true
  error.value = ''

  try {
    await api!.auth.createUser(newUsername.value, newDisplayName.value, newTempPassword.value)
    showCreateDialog.value = false
    newUsername.value = ''
    newDisplayName.value = ''
    newTempPassword.value = ''
    success.value = 'User created successfully'
    await loadUsers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create user'
  } finally {
    loading.value = false
  }
}

async function handleDeactivateUser(username: string): Promise<void> {
  try {
    await api!.auth.deactivateUser(username)
    success.value = `User ${username} deactivated`
    await loadUsers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to deactivate user'
  }
}

async function handleResetPassword(): Promise<void> {
  if (!resetPassword.value || !selectedUser.value) return

  loading.value = true
  error.value = ''

  try {
    await api!.auth.resetPassword(selectedUser.value, resetPassword.value)
    showResetDialog.value = false
    resetPassword.value = ''
    selectedUser.value = ''
    success.value = 'Password reset successfully'
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to reset password'
  } finally {
    loading.value = false
  }
}

function openResetDialog(username: string): void {
  selectedUser.value = username
  resetPassword.value = ''
  showResetDialog.value = true
}

onMounted(loadUsers)
</script>

<template>
  <v-card v-if="authStore.isAdmin" flat>
    <v-card-title class="d-flex align-center">
      <span>User Management</span>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showCreateDialog = true">
        Add User
      </v-btn>
    </v-card-title>

    <v-card-text>
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
      <v-alert
        v-if="success"
        type="success"
        variant="tonal"
        class="mb-4"
        closable
        @click:close="success = ''"
      >
        {{ success }}
      </v-alert>

      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Username</th>
            <th>Display Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id">
            <td>{{ user.username }}</td>
            <td>{{ user.display_name || '--' }}</td>
            <td>
              <v-chip :color="user.role === 'admin' ? 'primary' : 'default'" size="small">
                {{ user.role }}
              </v-chip>
            </td>
            <td>
              <v-chip :color="user.is_active ? 'success' : 'error'" size="small">
                {{ user.is_active ? 'Active' : 'Inactive' }}
              </v-chip>
            </td>
            <td>
              <v-btn
                v-if="user.username !== authStore.currentUser?.username && user.is_active"
                icon="mdi-lock-reset"
                size="small"
                variant="text"
                title="Reset Password"
                @click="openResetDialog(user.username)"
              />
              <v-btn
                v-if="user.username !== authStore.currentUser?.username && user.is_active"
                icon="mdi-account-off"
                size="small"
                variant="text"
                color="error"
                title="Deactivate"
                @click="handleDeactivateUser(user.username)"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>

    <!-- Create User Dialog -->
    <v-dialog v-model="showCreateDialog" max-width="500">
      <v-card>
        <v-card-title>Create User</v-card-title>
        <v-card-text>
          <v-form @submit.prevent="handleCreateUser">
            <v-text-field v-model="newUsername" label="Username" variant="outlined" class="mb-2" />
            <v-text-field
              v-model="newDisplayName"
              label="Display Name"
              variant="outlined"
              class="mb-2"
            />
            <v-text-field
              v-model="newTempPassword"
              type="password"
              label="Temporary Password"
              hint="User will be required to change this on first login"
              variant="outlined"
              class="mb-2"
            />
            <v-btn
              type="submit"
              color="primary"
              block
              :loading="loading"
              :disabled="!newUsername || !newTempPassword"
            >
              Create User
            </v-btn>
          </v-form>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Reset Password Dialog -->
    <v-dialog v-model="showResetDialog" max-width="400">
      <v-card>
        <v-card-title>Reset Password for {{ selectedUser }}</v-card-title>
        <v-card-text>
          <v-form @submit.prevent="handleResetPassword">
            <v-text-field
              v-model="resetPassword"
              type="password"
              label="New Password"
              variant="outlined"
              class="mb-2"
            />
            <v-btn
              type="submit"
              color="primary"
              block
              :loading="loading"
              :disabled="!resetPassword"
            >
              Reset Password
            </v-btn>
          </v-form>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-card>
</template>
