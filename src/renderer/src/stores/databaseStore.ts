/**
 * Pinia store for database selection and management
 * Manages current database state, recent databases, and database operations
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { DatabaseOpenResult, RecentDatabase, WindowAPI } from '../../../shared/types/api'
import { unwrapIpcResult } from '../../../shared/types/errors'

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

  // Actions
  async function fetchInfo(): Promise<void> {
    const info = unwrapIpcResult(await getApi().database.info())
    if (info) {
      currentPath.value = info.path
      currentName.value = info.name
      isEncrypted.value = info.encrypted
    } else {
      currentPath.value = null
      currentName.value = ''
      isEncrypted.value = false
    }
    await fetchRecent()
  }

  async function fetchRecent(): Promise<void> {
    recentDatabases.value = unwrapIpcResult(await getApi().database.recentList())
  }

  async function openDatabase(path: string, password?: string): Promise<DatabaseOpenResult> {
    isLoading.value = true
    try {
      const result = unwrapIpcResult(await getApi().database.open(path, password))
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
      const result = unwrapIpcResult(await getApi().database.create(path, password))
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
    fetchInfo,
    fetchRecent,
    openDatabase,
    createDatabase,
    selectAndOpenFile,
    selectSaveLocation,
    changePassword
  }
})
