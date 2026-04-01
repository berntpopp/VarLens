/**
 * Pinia store for user preferences / settings
 * Persisted to localStorage so choices survive across sessions.
 */

import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { logService } from '../services/LogService'

const STORAGE_KEY = 'varlens_user_settings_v1'

interface PersistedSettings {
  itemsPerPage: number
  userName: string
  workerThreads: number // 0 = auto (cpus - 1)
  prefetchEnabled: boolean
}

const DEFAULTS: PersistedSettings = {
  itemsPerPage: 25,
  userName: '',
  workerThreads: 0,
  prefetchEnabled: true
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null && raw !== '') {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>
      return { ...DEFAULTS, ...parsed }
    }
  } catch (e) {
    logService.warn(
      'Failed to load settings from localStorage: ' + (e instanceof Error ? e.message : String(e)),
      'settings'
    )
  }
  return { ...DEFAULTS }
}

function save(settings: PersistedSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export const useSettingsStore = defineStore('settings', () => {
  const persisted = load()

  const itemsPerPage = ref(persisted.itemsPerPage)
  const userName = ref(persisted.userName)
  const workerThreads = ref(persisted.workerThreads)
  const prefetchEnabled = ref(persisted.prefetchEnabled)

  // Auto-persist on change
  watch([itemsPerPage, userName, workerThreads, prefetchEnabled], () => {
    save({
      itemsPerPage: itemsPerPage.value,
      userName: userName.value,
      workerThreads: workerThreads.value,
      prefetchEnabled: prefetchEnabled.value
    })
  })

  return {
    itemsPerPage,
    userName,
    workerThreads,
    prefetchEnabled
  }
})
