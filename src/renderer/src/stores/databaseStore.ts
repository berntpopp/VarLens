/**
 * Pinia store for database selection and management
 * Manages current database state, recent databases, and database operations
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DatabaseOpenResult, RecentDatabase, WindowAPI } from '../../../shared/types/api'
import { unwrapIpcResult } from '../../../shared/types/errors'
import type {
  PostgresConnectionProfileInput,
  PostgresConnectionProfilePublic,
  PostgresConnectionProfileSaveInput,
  PostgresConnectionTestResult
} from '../../../shared/types/postgres-profile'
import type { StorageCapabilities } from '../../../shared/types/storage-capabilities'

/** Lazy accessor for window.api -- avoids import-time evaluation */
function getApi(): WindowAPI {
  if (typeof window === 'undefined' || typeof window.api === 'undefined') {
    throw new Error('Database store requires Electron API (window.api)')
  }
  return window.api
}

/**
 * Database store using setup store pattern
 */
export const useDatabaseStore = defineStore('database', () => {
  // State
  const currentPath = ref<string | null>(null)
  const currentName = ref<string>('')
  const isEncrypted = ref<boolean>(false)
  const isLoading = ref<boolean>(false)
  const recentDatabases = ref<RecentDatabase[]>([])
  const capabilities = ref<StorageCapabilities | null>(null)
  const postgresProfiles = ref<PostgresConnectionProfilePublic[]>([])
  const isTestingPostgres = ref<boolean>(false)

  // Actions
  async function fetchInfo(): Promise<void> {
    const info = unwrapIpcResult(await getApi().database.info())
    if (info) {
      currentPath.value = info.path
      currentName.value = info.name
      isEncrypted.value = info.encrypted
      await loadCapabilities()
    } else {
      currentPath.value = null
      currentName.value = ''
      isEncrypted.value = false
      capabilities.value = null
    }
    await fetchRecent()
  }

  async function fetchRecent(): Promise<void> {
    recentDatabases.value = unwrapIpcResult(await getApi().database.recentList())
  }

  async function loadCapabilities(): Promise<void> {
    capabilities.value = unwrapIpcResult(await getApi().database.capabilities())
  }

  async function fetchPostgresProfiles(): Promise<void> {
    postgresProfiles.value = unwrapIpcResult(await getApi().database.postgresProfilesList())
  }

  async function savePostgresProfile(
    input: PostgresConnectionProfileSaveInput
  ): Promise<PostgresConnectionProfilePublic> {
    const profile = unwrapIpcResult(await getApi().database.postgresProfileSave(input))
    await fetchPostgresProfiles()
    return profile
  }

  async function removePostgresProfile(profileId: string): Promise<{ success: boolean }> {
    const result = unwrapIpcResult(await getApi().database.postgresProfileRemove(profileId))
    await fetchPostgresProfiles()
    return result
  }

  async function testPostgresProfile(
    input: PostgresConnectionProfileInput
  ): Promise<PostgresConnectionTestResult> {
    isTestingPostgres.value = true
    try {
      return unwrapIpcResult(await getApi().database.postgresProfileTest(input))
    } finally {
      isTestingPostgres.value = false
    }
  }

  async function openDatabase(path: string, password?: string): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = unwrapIpcResult(await getApi().database.open(path, password))
      if (result.success && result.info) {
        currentPath.value = result.info.path
        currentName.value = result.info.name
        isEncrypted.value = result.info.encrypted
        await loadCapabilities()
        await fetchRecent()
      }
      return result
    } finally {
      isLoading.value = false
    }
  }

  async function createDatabase(
    path: string,
    password?: string,
    setupPassphrase?: string
  ): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = unwrapIpcResult(
        await getApi().database.create(path, password, setupPassphrase)
      )
      if (result.success && result.info) {
        currentPath.value = result.info.path
        currentName.value = result.info.name
        isEncrypted.value = result.info.encrypted
        await loadCapabilities()
        await fetchRecent()
      }
      return result
    } finally {
      isLoading.value = false
    }
  }

  async function openPostgresProfile(profileId: string): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = unwrapIpcResult(await getApi().database.postgresProfileOpen(profileId))
      if (result.success && result.info) {
        currentPath.value = result.info.path
        currentName.value = result.info.name
        isEncrypted.value = result.info.encrypted
        await loadCapabilities()
        await fetchRecent()
        await fetchPostgresProfiles()
      }
      return result
    } finally {
      isLoading.value = false
    }
  }

  async function selectAndOpenFile(): Promise<DatabaseOpenResult | null> {
    const path = await getApi().database.selectFile()
    if (path === null) {
      return null
    }
    return await openDatabase(path)
  }

  async function selectSaveLocation(defaultName: string): Promise<string | null> {
    return await getApi().database.selectSaveLocation(defaultName)
  }

  async function changePassword(
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    return unwrapIpcResult(await getApi().database.rekey(newPassword))
  }

  return {
    currentPath,
    currentName,
    isEncrypted,
    isLoading,
    recentDatabases,
    capabilities,
    postgresProfiles,
    isTestingPostgres,
    fetchInfo,
    fetchRecent,
    loadCapabilities,
    fetchPostgresProfiles,
    savePostgresProfile,
    removePostgresProfile,
    testPostgresProfile,
    openDatabase,
    createDatabase,
    openPostgresProfile,
    selectAndOpenFile,
    selectSaveLocation,
    changePassword
  }
})
