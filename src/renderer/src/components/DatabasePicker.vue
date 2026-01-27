<template>
  <v-menu>
    <template #activator="{ props }">
      <v-btn variant="text" v-bind="props" class="text-none">
        <v-progress-circular
          v-if="databaseStore.isLoading"
          indeterminate
          size="16"
          width="2"
          class="mr-2"
        />
        <v-icon v-else-if="databaseStore.isEncrypted" icon="mdi-lock" size="small" class="mr-2" />
        <span class="text-body-2">{{ databaseStore.currentName || 'No database' }}</span>
        <v-tooltip activator="parent" location="bottom">
          {{ databaseStore.currentPath || 'No database' }}
        </v-tooltip>
      </v-btn>
    </template>

    <v-list>
      <!-- Recent databases section -->
      <v-list-subheader>Recent Databases</v-list-subheader>
      <template v-if="databaseStore.recentDatabases.length > 0">
        <v-list-item
          v-for="db in databaseStore.recentDatabases"
          :key="db.path"
          @click="handleOpenRecent(db.path)"
        >
          <template #prepend>
            <v-icon icon="mdi-database" />
          </template>
          <v-list-item-title>{{ db.name }}</v-list-item-title>
          <v-list-item-subtitle class="text-truncate">{{ db.path }}</v-list-item-subtitle>
        </v-list-item>
      </template>
      <v-list-item v-else disabled>
        <v-list-item-title class="text-caption text-disabled"
          >No recent databases</v-list-item-title
        >
      </v-list-item>

      <v-divider />

      <!-- Actions -->
      <v-list-item @click="handleOpen">
        <template #prepend>
          <v-icon icon="mdi-folder-open" />
        </template>
        <v-list-item-title>Open...</v-list-item-title>
      </v-list-item>

      <v-list-item @click="handleCreate">
        <template #prepend>
          <v-icon icon="mdi-database-plus" />
        </template>
        <v-list-item-title>New...</v-list-item-title>
      </v-list-item>

      <!-- Change password (only for encrypted databases) -->
      <template v-if="databaseStore.isEncrypted">
        <v-divider />
        <v-list-item @click="handleChangePassword">
          <template #prepend>
            <v-icon icon="mdi-lock-reset" />
          </template>
          <v-list-item-title>Change Password...</v-list-item-title>
        </v-list-item>
      </template>
    </v-list>
  </v-menu>

  <!-- Child dialogs -->
  <PasswordDialog ref="passwordDialogRef" />
  <CreateDatabaseDialog ref="createDialogRef" @database-created="handleDatabaseCreated" />
  <ChangePasswordDialog ref="changePasswordDialogRef" @password-changed="handlePasswordChanged" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useDatabaseStore } from '../stores/databaseStore'
import PasswordDialog from './PasswordDialog.vue'
import CreateDatabaseDialog from './CreateDatabaseDialog.vue'
import ChangePasswordDialog from './ChangePasswordDialog.vue'

const databaseStore = useDatabaseStore()

// Component refs
const passwordDialogRef = ref<InstanceType<typeof PasswordDialog> | null>(null)
const createDialogRef = ref<InstanceType<typeof CreateDatabaseDialog> | null>(null)
const changePasswordDialogRef = ref<InstanceType<typeof ChangePasswordDialog> | null>(null)

// Track pending password authentication
const pendingOpenPath = ref<string | null>(null)

// Emits
const emit = defineEmits<{
  'database-switched': []
  error: [message: string]
}>()

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

function handleChangePassword(): void {
  changePasswordDialogRef.value?.show()
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
</script>

<style scoped>
.text-truncate {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
