<template>
  <v-menu @update:model-value="handleMenuToggle">
    <template #activator="{ props }">
      <v-btn variant="text" v-bind="props" class="text-none" data-testid="database-picker">
        <v-progress-circular
          v-if="databaseStore.isLoading"
          indeterminate
          size="16"
          width="2"
          class="mr-2"
        />
        <v-icon v-else-if="databaseStore.isEncrypted" :icon="mdiLock" size="small" class="mr-2" />
        <span class="text-body-medium">{{ databaseStore.currentName || 'No database' }}</span>
        <v-tooltip activator="parent" location="bottom">
          {{ databaseStore.currentPath || 'No database' }}
        </v-tooltip>
      </v-btn>
    </template>

    <v-list v-if="isWebMode">
      <v-list-item>
        <template #prepend>
          <v-icon :icon="mdiDatabaseCog" />
        </template>
        <v-list-item-title>{{ databaseStore.currentName || 'VarLens Web' }}</v-list-item-title>
        <v-list-item-subtitle class="text-truncate">
          {{ databaseStore.currentPath || 'web:postgres' }}
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>

    <v-list v-else>
      <!-- Recent databases section -->
      <v-list-subheader>Recent Databases</v-list-subheader>
      <template v-if="databaseStore.recentDatabases.length > 0">
        <v-list-item
          v-for="db in databaseStore.recentDatabases"
          :key="db.path"
          @click="handleOpenRecent(db.path)"
        >
          <template #prepend>
            <v-icon :icon="mdiDatabase" />
          </template>
          <v-list-item-title>{{ db.name }}</v-list-item-title>
          <v-list-item-subtitle class="text-truncate">{{ db.path }}</v-list-item-subtitle>
          <template #append>
            <div class="d-flex align-center ml-2">
              <v-btn
                icon
                size="x-small"
                variant="text"
                density="compact"
                @click.stop="handleShowInFolder(db.path)"
              >
                <v-icon :icon="mdiFolderEye" size="x-small" />
                <v-tooltip activator="parent" location="top">Show in folder</v-tooltip>
              </v-btn>
              <v-btn
                v-if="db.path !== databaseStore.currentPath"
                icon
                size="x-small"
                variant="text"
                density="compact"
                @click.stop="handleRemoveRecent(db.path)"
              >
                <v-icon :icon="mdiClose" size="x-small" />
                <v-tooltip activator="parent" location="top">Remove from list</v-tooltip>
              </v-btn>
              <v-btn
                v-if="db.path !== databaseStore.currentPath"
                icon
                size="x-small"
                variant="text"
                density="compact"
                color="error"
                @click.stop="handleDeleteFile(db)"
              >
                <v-icon :icon="mdiDeleteOutline" size="x-small" />
                <v-tooltip activator="parent" location="top">Delete file from disk</v-tooltip>
              </v-btn>
            </div>
          </template>
        </v-list-item>
      </template>
      <v-list-item v-else disabled>
        <v-list-item-title class="text-body-small text-disabled"
          >No recent databases</v-list-item-title
        >
      </v-list-item>

      <v-divider />

      <!-- PostgreSQL profiles section -->
      <v-list-subheader>PostgreSQL Workspaces</v-list-subheader>
      <template v-if="databaseStore.postgresProfiles.length > 0">
        <v-list-item v-for="profile in databaseStore.postgresProfiles" :key="profile.id">
          <template #prepend>
            <v-icon :icon="mdiDatabaseCog" />
          </template>
          <v-list-item-title>{{ profile.name }}</v-list-item-title>
          <v-list-item-subtitle class="text-truncate">
            {{ profile.host }}:{{ profile.port }}/{{ profile.database }}
          </v-list-item-subtitle>
          <template #append>
            <div class="d-flex align-center ml-2">
              <v-btn
                icon
                size="x-small"
                variant="text"
                density="compact"
                :aria-label="`Connect PostgreSQL workspace ${profile.name}`"
                @click.stop="handleOpenPostgresProfile(profile.id)"
              >
                <v-icon :icon="mdiConnection" size="x-small" />
                <v-tooltip activator="parent" location="top">Connect</v-tooltip>
              </v-btn>
              <v-btn
                icon
                size="x-small"
                variant="text"
                density="compact"
                :aria-label="`Edit PostgreSQL workspace ${profile.name}`"
                @click.stop="handleEditPostgresProfile(profile)"
              >
                <v-icon :icon="mdiPencil" size="x-small" />
                <v-tooltip activator="parent" location="top">Edit</v-tooltip>
              </v-btn>
              <v-btn
                icon
                size="x-small"
                variant="text"
                density="compact"
                color="error"
                :aria-label="`Remove PostgreSQL workspace ${profile.name}`"
                @click.stop="handleRemovePostgresProfile(profile.id)"
              >
                <v-icon :icon="mdiDeleteOutline" size="x-small" />
                <v-tooltip activator="parent" location="top">Remove</v-tooltip>
              </v-btn>
            </div>
          </template>
        </v-list-item>
      </template>
      <v-list-item v-else disabled>
        <v-list-item-title class="text-body-small text-disabled"
          >No PostgreSQL workspaces</v-list-item-title
        >
      </v-list-item>

      <v-divider />

      <!-- Actions -->
      <v-list-item @click="handleOpen">
        <template #prepend>
          <v-icon :icon="mdiFolderOpen" />
        </template>
        <v-list-item-title>Open...</v-list-item-title>
      </v-list-item>

      <v-list-item @click="handleCreate">
        <template #prepend>
          <v-icon :icon="mdiDatabasePlus" />
        </template>
        <v-list-item-title>New...</v-list-item-title>
      </v-list-item>

      <v-list-item @click="handleAddPostgresProfile">
        <template #prepend>
          <v-icon :icon="mdiPlus" />
        </template>
        <v-list-item-title>Add PostgreSQL...</v-list-item-title>
        <template #append>
          <v-btn
            icon
            size="x-small"
            variant="text"
            density="compact"
            aria-label="Add PostgreSQL workspace"
            @click.stop="handleAddPostgresProfile"
          >
            <v-icon :icon="mdiPlus" size="x-small" />
            <v-tooltip activator="parent" location="top">Add PostgreSQL workspace</v-tooltip>
          </v-btn>
        </template>
      </v-list-item>

      <!-- Change password / set recovery passphrase (only for encrypted databases) -->
      <template v-if="databaseStore.isEncrypted">
        <v-divider />
        <v-list-item v-if="databaseStore.keyManaged" @click="handleSetRecoveryPassphrase">
          <template #prepend>
            <v-icon :icon="mdiKeyPlus" />
          </template>
          <v-list-item-title>Set Recovery Passphrase...</v-list-item-title>
        </v-list-item>
        <!--
          "Change Password..." performs a raw `PRAGMA rekey`, which changes
          the LIVE SQLCipher key directly. For a key-store-managed database
          (created encrypted-by-default, or migrated to encrypted) that would
          desynchronize the live key from the key-store's wrapped DEK and can
          make the database unopenable -- see `rekeyDatabase` in
          `database-lifecycle-logic.ts`. Managed databases use
          "Set Recovery Passphrase..." above instead, which safely re-wraps
          the SAME key. Only offer "Change Password..." for legacy
          explicit-password databases that have no managed key.
        -->
        <v-list-item v-if="!databaseStore.keyManaged" @click="handleChangePassword">
          <template #prepend>
            <v-icon :icon="mdiLockReset" />
          </template>
          <v-list-item-title>Change Password...</v-list-item-title>
        </v-list-item>
      </template>

      <!-- Encrypt database (only for a currently open, plaintext SQLite database) -->
      <template v-if="databaseStore.unencryptedMigratable">
        <v-divider />
        <v-list-item @click="handleEncryptDatabase">
          <template #prepend>
            <v-icon :icon="mdiLock" />
          </template>
          <v-list-item-title>Encrypt Database...</v-list-item-title>
        </v-list-item>
      </template>
    </v-list>
  </v-menu>

  <!-- Child dialogs -->
  <PasswordDialog ref="passwordDialogRef" />
  <CreateDatabaseDialog ref="createDialogRef" @database-created="handleDatabaseCreated" />
  <ChangePasswordDialog ref="changePasswordDialogRef" @password-changed="handlePasswordChanged" />
  <SetRecoveryPassphraseDialog
    ref="setRecoveryPassphraseDialogRef"
    @recovery-passphrase-set="handleRecoveryPassphraseSet"
  />
  <EncryptDatabaseDialog
    ref="encryptDialogRef"
    @database-migrated="handleDatabaseMigrated"
    @request-recovery-passphrase="handleRequestRecoveryPassphrase"
    @error="handleEncryptDatabaseError"
  />
  <PostgresConnectionDialog
    ref="postgresDialogRef"
    @saved="handlePostgresProfileSaved"
    @connected="handlePostgresConnected"
    @error="handlePostgresError"
  />

  <!-- Delete confirmation dialog -->
  <v-dialog v-model="deleteDialog" max-width="440">
    <v-card>
      <v-card-title>Delete Database</v-card-title>
      <v-card-text>
        Permanently delete <strong>{{ pendingDeleteDb?.name }}</strong> from disk? This cannot be
        undone.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="deleteDialog = false">Cancel</v-btn>
        <v-btn color="error" variant="elevated" @click="confirmDeleteFile">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDatabaseStore } from '../stores/databaseStore'
import { useApiService } from '../composables/useApiService'
import { isWebRuntime } from '../utils/runtime-mode'
import PasswordDialog from './PasswordDialog.vue'
import CreateDatabaseDialog from './CreateDatabaseDialog.vue'
import ChangePasswordDialog from './ChangePasswordDialog.vue'
import SetRecoveryPassphraseDialog from './SetRecoveryPassphraseDialog.vue'
import EncryptDatabaseDialog from './EncryptDatabaseDialog.vue'
import PostgresConnectionDialog from './PostgresConnectionDialog.vue'
import type { RecentDatabase } from '../../../shared/types/api'
import type { PostgresConnectionProfilePublic } from '../../../shared/types/postgres-profile'
import { isIpcError, unwrapIpcResult } from '../../../shared/types/errors'
import {
  mdiClose,
  mdiConnection,
  mdiDatabase,
  mdiDatabaseCog,
  mdiDatabasePlus,
  mdiDeleteOutline,
  mdiFolderEye,
  mdiFolderOpen,
  mdiKeyPlus,
  mdiLock,
  mdiLockReset,
  mdiPencil,
  mdiPlus
} from '@mdi/js'

const databaseStore = useDatabaseStore()
const { api } = useApiService()
const isWebMode = isWebRuntime()

// Component refs
const passwordDialogRef = ref<InstanceType<typeof PasswordDialog> | null>(null)
const createDialogRef = ref<InstanceType<typeof CreateDatabaseDialog> | null>(null)
const changePasswordDialogRef = ref<InstanceType<typeof ChangePasswordDialog> | null>(null)
const setRecoveryPassphraseDialogRef = ref<InstanceType<typeof SetRecoveryPassphraseDialog> | null>(
  null
)
const encryptDialogRef = ref<InstanceType<typeof EncryptDatabaseDialog> | null>(null)
const postgresDialogRef = ref<InstanceType<typeof PostgresConnectionDialog> | null>(null)

// Track pending password authentication
const pendingOpenPath = ref<string | null>(null)

// Delete confirmation state
const deleteDialog = ref(false)
const pendingDeleteDb = ref<RecentDatabase | null>(null)

// Emits
const emit = defineEmits<{
  'database-switched': []
  error: [message: string]
}>()

onMounted(() => {
  if (!isWebMode) {
    void fetchPostgresProfiles()
  }
})

// Handlers
async function handleOpenRecent(path: string): Promise<void> {
  const result = await databaseStore.openDatabase(path)

  if (result.needsPassword === true) {
    pendingOpenPath.value = path
    passwordDialogRef.value?.show(handlePasswordSubmit)
  } else if (result.success) {
    emit('database-switched')
  } else if (result.error !== undefined) {
    emit('error', result.error)
  }
}

async function handleOpen(): Promise<void> {
  const result = await databaseStore.selectAndOpenFile()

  if (result === null) {
    // User cancelled
    return
  }

  if (result.needsPassword === true && result.info !== undefined) {
    pendingOpenPath.value = result.info.path
    passwordDialogRef.value?.show(handlePasswordSubmit)
  } else if (result.success) {
    emit('database-switched')
  } else if (result.error !== undefined) {
    emit('error', result.error)
  }
}

function handleCreate(): void {
  createDialogRef.value?.show()
}

function handleAddPostgresProfile(): void {
  postgresDialogRef.value?.show()
}

function handleEditPostgresProfile(profile: PostgresConnectionProfilePublic): void {
  postgresDialogRef.value?.show(profile)
}

function handleChangePassword(): void {
  changePasswordDialogRef.value?.show()
}

function handleSetRecoveryPassphrase(): void {
  setRecoveryPassphraseDialogRef.value?.show()
}

function handleEncryptDatabase(): void {
  encryptDialogRef.value?.show()
}

function handleDatabaseMigrated(): void {
  emit('database-switched')
}

/**
 * The "Set Recovery Passphrase Now" affordance inside `EncryptDatabaseDialog`'s
 * success phase opens this dialog on top of it -- both dialogs are owned
 * here so `EncryptDatabaseDialog` stays open underneath, preserving its
 * still-pending plaintext-backup decision.
 */
function handleRequestRecoveryPassphrase(): void {
  setRecoveryPassphraseDialogRef.value?.show()
}

/**
 * Setting a recovery passphrase only re-wraps the existing key -- it never
 * changes the live database connection or its data, so (unlike
 * `handleDatabaseMigrated`/`handlePasswordChanged`) there is nothing here
 * that needs a `database-switched` refresh. The dialog itself already
 * confirms success by closing.
 */
function handleRecoveryPassphraseSet(): void {
  // Intentional no-op -- see doc comment above.
}

function handleEncryptDatabaseError(message: string): void {
  emit('error', message)
}

async function handlePasswordSubmit(
  password: string
): Promise<{ success: boolean; error?: string }> {
  if (pendingOpenPath.value === null) {
    return { success: false, error: 'No pending path' }
  }

  const result = await databaseStore.openDatabase(pendingOpenPath.value, password)

  if (result.success) {
    pendingOpenPath.value = null
    emit('database-switched')
    return { success: true }
  } else {
    return { success: false, error: result.error }
  }
}

function handleDatabaseCreated(): void {
  emit('database-switched')
}

function handlePasswordChanged(): void {
  emit('database-switched')
}

async function handleMenuToggle(isOpen: boolean): Promise<void> {
  if (isOpen && !isWebMode) {
    await fetchPostgresProfiles()
  }
}

async function fetchPostgresProfiles(): Promise<void> {
  try {
    await databaseStore.fetchPostgresProfiles()
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
    )
  }
}

async function handleOpenPostgresProfile(profileId: string): Promise<void> {
  try {
    const result = await databaseStore.openPostgresProfile(profileId)

    if (result.success) {
      emit('database-switched')
    } else if (result.error !== undefined) {
      emit('error', result.error)
    }
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
    )
  }
}

async function handleRemovePostgresProfile(profileId: string): Promise<void> {
  try {
    await databaseStore.removePostgresProfile(profileId)
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
    )
  }
}

async function handlePostgresProfileSaved(): Promise<void> {
  await fetchPostgresProfiles()
}

function handlePostgresConnected(): void {
  emit('database-switched')
}

function handlePostgresError(message: string): void {
  emit('error', message)
}

async function handleRemoveRecent(path: string): Promise<void> {
  if (!api) return
  try {
    unwrapIpcResult(await api.database.removeRecent(path))
    await databaseStore.fetchRecent()
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
    )
  }
}

async function handleShowInFolder(path: string): Promise<void> {
  if (!api) return
  try {
    unwrapIpcResult(await api.database.showInFolder(path))
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
    )
  }
}

function handleDeleteFile(db: RecentDatabase): void {
  pendingDeleteDb.value = db
  deleteDialog.value = true
}

async function confirmDeleteFile(): Promise<void> {
  if (!pendingDeleteDb.value) return
  try {
    if (!api) return
    unwrapIpcResult(await api.database.deleteFile(pendingDeleteDb.value.path))
    await databaseStore.fetchRecent()
  } catch (e) {
    emit(
      'error',
      e instanceof Error ? e.message : isIpcError(e) ? (e.userMessage ?? e.message) : String(e)
    )
  } finally {
    deleteDialog.value = false
    pendingDeleteDb.value = null
  }
}
</script>

<style scoped>
.text-truncate {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
