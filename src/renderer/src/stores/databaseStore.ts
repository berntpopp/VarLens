/**
 * Pinia store for database selection and management
 * Manages current database state, recent databases, and database operations
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DatabaseOpenResult, RecentDatabase } from '../../../shared/types/api'

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

  // Actions
  async function fetchInfo(): Promise<void> {
    const info = await window.api.database.info()
    if (info) {
      currentPath.value = info.path
      currentName.value = info.name
      isEncrypted.value = info.encrypted
    }
    await fetchRecent()
  }

  async function fetchRecent(): Promise<void> {
    recentDatabases.value = await window.api.database.recentList()
  }

  async function openDatabase(path: string, password?: string): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = await window.api.database.open(path, password)
      if (result.success && result.info) {
        currentPath.value = result.info.path
        currentName.value = result.info.name
        isEncrypted.value = result.info.encrypted
        await fetchRecent()
      }
      return result
    } finally {
      isLoading.value = false
    }
  }

  async function createDatabase(path: string, password?: string): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = await window.api.database.create(path, password)
      if (result.success && result.info) {
        currentPath.value = result.info.path
        currentName.value = result.info.name
        isEncrypted.value = result.info.encrypted
        await fetchRecent()
      }
      return result
    } finally {
      isLoading.value = false
    }
  }

  async function selectAndOpenFile(): Promise<DatabaseOpenResult | null> {
    const path = await window.api.database.selectFile()
    if (path === null) {
      return null
    }
    return await openDatabase(path)
  }

  async function selectSaveLocation(defaultName: string): Promise<string | null> {
    return await window.api.database.selectSaveLocation(defaultName)
  }

  async function changePassword(
    newPassword: string
  ): Promise<{ success: boolean; error?: string }> {
    return await window.api.database.rekey(newPassword)
  }

  return {
    currentPath,
    currentName,
    isEncrypted,
    isLoading,
    recentDatabases,
    fetchInfo,
    fetchRecent,
    openDatabase,
    createDatabase,
    selectAndOpenFile,
    selectSaveLocation,
    changePassword
  }
})
