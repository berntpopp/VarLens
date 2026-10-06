<template>
  <template v-if="visible">
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <IconButton
          v-bind="menuProps"
          :label="`Account: ${authStore.displayName}`"
          tooltip="Account"
          :icon="mdiAccountCircle"
          data-testid="account-menu"
        />
      </template>
      <v-list density="compact" min-width="240">
        <v-list-item :prepend-icon="mdiAccountCircle" data-testid="account-identity">
          <v-list-item-title class="font-weight-medium">
            {{ authStore.displayName }}
          </v-list-item-title>
          <v-list-item-subtitle>{{ roleLabel }}</v-list-item-subtitle>
        </v-list-item>
        <!-- No v-divider: an <hr> inside role=list fails axe aria-required-children -->
        <v-list-item
          class="account-menu__group-start"
          :prepend-icon="mdiLockReset"
          title="Change password"
          @click="passwordOpen = true"
        />
        <v-list-item
          v-if="authStore.isAdmin"
          :prepend-icon="mdiAccountMultiple"
          title="User management"
          data-testid="open-user-management"
          @click="usersOpen = true"
        />
        <v-list-subheader class="account-menu__group-start">Theme</v-list-subheader>
        <v-list-item
          v-for="opt in THEME_PREFERENCE_OPTIONS"
          :key="opt.value"
          :title="opt.label"
          :active="settings.themePreference === opt.value"
          :aria-current="settings.themePreference === opt.value ? 'true' : undefined"
          :aria-label="`Theme: ${opt.label}`"
          :prepend-icon="settings.themePreference === opt.value ? mdiCheck : mdiBlankIcon"
          @click="settings.themePreference = opt.value"
        />
        <v-list-item
          class="account-menu__group-start"
          :prepend-icon="mdiLogout"
          title="Sign out"
          data-testid="sign-out"
          @click="signOut"
        />
      </v-list>
    </v-menu>

    <AccountPasswordDialog v-if="passwordOpen" v-model="passwordOpen" />

    <v-dialog v-model="usersOpen" max-width="900" scrollable aria-label="User management">
      <v-card>
        <div class="d-flex justify-end pa-1">
          <IconButton label="Close user management" :icon="mdiClose" @click="usersOpen = false" />
        </div>
        <UserManagement v-if="usersOpen" />
      </v-card>
    </v-dialog>
  </template>
</template>

<script setup lang="ts">
/**
 * Account menu for sessions with user accounts (always on in web mode):
 * identity + role, change password, admin-only user management, theme,
 * and sign out. Sign-out ends the server session and returns to the
 * login page (web) or reloads into the desktop login gate.
 */
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import {
  mdiAccountCircle,
  mdiAccountMultiple,
  mdiCheck,
  mdiClose,
  mdiLockReset,
  mdiLogout
} from '@mdi/js'
import IconButton from '../common/IconButton.vue'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { isWebRuntime } from '../../utils/runtime-mode'
import { THEME_PREFERENCE_OPTIONS } from '../../utils/theme-preference'
import { roleLabel as labelForRole } from '../../utils/role-labels'
import { logService } from '../../services/LogService'

// Dialog bodies load on first open so the toolbar chunk stays small.
const AccountPasswordDialog = defineAsyncComponent(() => import('./AccountPasswordDialog.vue'))
const UserManagement = defineAsyncComponent(() => import('../UserManagement.vue'))

/** Empty path keeps list items aligned without drawing an icon. */
const mdiBlankIcon = 'M0 0'

const authStore = useAuthStore()
const settings = useSettingsStore()
const passwordOpen = ref(false)
const usersOpen = ref(false)

const visible = computed(() => authStore.accountsEnabled && authStore.currentUser !== null)
const roleLabel = computed(() => labelForRole(authStore.currentUser?.role))

onMounted(() => {
  if (isWebRuntime() || authStore.accountsEnabled) void authStore.checkAccountsEnabled()
})

function loginUrl(): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/login`
}

async function signOut(): Promise<void> {
  try {
    await authStore.logout()
  } catch {
    // authStore already logged the failure; still leave the session UI.
    logService.warn('Sign-out request failed; redirecting anyway', 'auth')
  }
  if (isWebRuntime()) window.location.assign(loginUrl())
  else window.location.reload()
}
</script>

<style scoped>
.account-menu__group-start {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
