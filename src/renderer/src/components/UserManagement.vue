<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '../stores/authStore'
import { useUserAdmin, type ManagedUser, type UserRole } from '../composables/useUserAdmin'
import { mdiAccountCheck, mdiAccountOff, mdiLockReset, mdiPlus } from '@mdi/js'
import IconButton from './common/IconButton.vue'
import { DEFAULT_USER_ROLE } from '../../../shared/auth/auth-constants'
import { ROLE_OPTIONS } from '../utils/role-labels'

const authStore = useAuthStore()
const { users, busy, error, success, loadUsers, createUser, setRole, resetPassword, setActive } =
  useUserAdmin()

/** Server policy (web): temporary and reset passwords need 12+ characters. */
const PASSWORD_HINT = 'At least 12 characters. The user must change it at first sign-in.'

const showCreateDialog = ref(false)
const newUsername = ref('')
const newDisplayName = ref('')
const newTempPassword = ref('')
const newRole = ref<UserRole>(DEFAULT_USER_ROLE)

const showResetDialog = ref(false)
const selectedUser = ref('')
const resetPasswordValue = ref('')

const confirmTarget = ref<ManagedUser | null>(null)

function isSelf(user: ManagedUser): boolean {
  return user.username === authStore.currentUser?.username
}

async function handleCreateUser(): Promise<void> {
  if (!newUsername.value || !newTempPassword.value) return
  const ok = await createUser(
    newUsername.value,
    newDisplayName.value,
    newTempPassword.value,
    newRole.value
  )
  if (ok) {
    showCreateDialog.value = false
    newUsername.value = ''
    newDisplayName.value = ''
    newTempPassword.value = ''
    newRole.value = DEFAULT_USER_ROLE
  }
}

async function handleRoleChange(user: ManagedUser, role: UserRole): Promise<void> {
  if (role !== user.role) await setRole(user.username, role)
}

function openResetDialog(username: string): void {
  selectedUser.value = username
  resetPasswordValue.value = ''
  showResetDialog.value = true
}

async function handleResetPassword(): Promise<void> {
  if (!resetPasswordValue.value || !selectedUser.value) return
  if (await resetPassword(selectedUser.value, resetPasswordValue.value)) {
    showResetDialog.value = false
  }
}

async function confirmToggleActive(): Promise<void> {
  const user = confirmTarget.value
  confirmTarget.value = null
  if (user !== null) await setActive(user.username, user.is_active !== 1)
}

onMounted(loadUsers)
</script>

<template>
  <v-card v-if="authStore.isAdmin" flat>
    <v-card-title class="d-flex align-center">
      <span>User Management</span>
      <v-spacer />
      <v-btn color="primary" :prepend-icon="mdiPlus" @click="showCreateDialog = true">
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
        role="alert"
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
        role="status"
        @click:close="success = ''"
      >
        {{ success }}
      </v-alert>

      <v-table density="comfortable" data-testid="user-management-table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Display Name</th>
            <th>Role</th>
            <th>Status</th>
            <th><span class="visually-hidden">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" :data-testid="`user-row-${user.username}`">
            <td>{{ user.username }}</td>
            <td>{{ user.display_name || '—' }}</td>
            <td style="min-width: 130px">
              <v-select
                :model-value="user.role"
                :items="ROLE_OPTIONS"
                :disabled="isSelf(user) || busy"
                :aria-label="`Role for ${user.username}`"
                hide-details
                density="compact"
                @update:model-value="(r: string) => handleRoleChange(user, r as UserRole)"
              />
            </td>
            <td>
              <v-chip :color="user.is_active ? 'success' : 'error'" size="small" label>
                {{ user.is_active ? 'Active' : 'Disabled' }}
              </v-chip>
              <v-chip v-if="user.must_change_password" size="small" class="ml-1" label>
                Must change password
              </v-chip>
            </td>
            <td class="text-no-wrap">
              <template v-if="!isSelf(user)">
                <IconButton
                  :label="`Reset password for ${user.username}`"
                  :icon="mdiLockReset"
                  :disabled="busy"
                  @click="openResetDialog(user.username)"
                />
                <IconButton
                  :label="
                    user.is_active ? `Disable ${user.username}` : `Re-enable ${user.username}`
                  "
                  :icon="user.is_active ? mdiAccountOff : mdiAccountCheck"
                  :icon-color="user.is_active ? 'error' : 'success'"
                  :disabled="busy"
                  @click="confirmTarget = user"
                />
              </template>
              <span v-else class="text-medium-emphasis text-body-small">You</span>
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
            <v-text-field v-model="newUsername" label="Username" autocomplete="off" class="mb-2" />
            <v-text-field v-model="newDisplayName" label="Display Name" class="mb-2" />
            <v-text-field
              v-model="newTempPassword"
              type="password"
              label="Temporary Password"
              autocomplete="new-password"
              :hint="PASSWORD_HINT"
              persistent-hint
              class="mb-4"
            />
            <v-select
              v-model="newRole"
              :items="ROLE_OPTIONS"
              label="Role"
              item-props
              hint="Viewers are read-only. You can change the role later."
              persistent-hint
              class="mb-4"
              data-testid="create-user-role"
            />
            <v-btn
              type="submit"
              color="primary"
              block
              :loading="busy"
              :disabled="!newUsername || !newTempPassword"
            >
              Create User
            </v-btn>
          </v-form>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Reset Password Dialog -->
    <v-dialog v-model="showResetDialog" max-width="420">
      <v-card>
        <v-card-title>Reset Password for {{ selectedUser }}</v-card-title>
        <v-card-text>
          <v-form @submit.prevent="handleResetPassword">
            <v-text-field
              v-model="resetPasswordValue"
              type="password"
              label="New Temporary Password"
              autocomplete="new-password"
              :hint="PASSWORD_HINT"
              persistent-hint
              class="mb-4"
            />
            <v-btn
              type="submit"
              color="primary"
              block
              :loading="busy"
              :disabled="!resetPasswordValue"
            >
              Reset Password
            </v-btn>
          </v-form>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Disable / re-enable confirmation -->
    <v-dialog
      :model-value="confirmTarget !== null"
      max-width="420"
      @update:model-value="(v: boolean) => !v && (confirmTarget = null)"
    >
      <v-card v-if="confirmTarget">
        <v-card-title>
          {{ confirmTarget.is_active ? 'Disable' : 'Re-enable' }} {{ confirmTarget.username }}?
        </v-card-title>
        <v-card-text>
          {{
            confirmTarget.is_active
              ? 'The user is signed out on their next request and cannot sign in until re-enabled.'
              : 'The user can sign in again with their current password.'
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmTarget = null">Cancel</v-btn>
          <v-btn
            :color="confirmTarget.is_active ? 'error' : 'primary'"
            variant="flat"
            data-testid="confirm-toggle-active"
            @click="confirmToggleActive"
          >
            {{ confirmTarget.is_active ? 'Disable' : 'Re-enable' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
