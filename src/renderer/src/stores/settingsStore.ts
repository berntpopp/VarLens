/**
 * Pinia store for user preferences / settings
 * Persisted to localStorage so choices survive across sessions.
 */

import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { logService } from '../services/LogService'
import {
  DEFAULT_THEME_PREFERENCE,
  SETTINGS_STORAGE_KEY,
  isThemePreference,
  type ThemePreference
} from '../utils/theme-preference'

const STORAGE_KEY = SETTINGS_STORAGE_KEY

/**
 * Which tab should be active by default when a CaseView mounts on a
 * non-empty case:
 *
 *   'shortlist' — land on the algorithmic ranked Shortlist view.
 *                 Default; best when the shortlist heuristic matches
 *                 your workflow.
 *   'snv'       — land on the first present per-type tab (SNV/indel
 *                 if the case has them, otherwise the first available
 *                 non-SNV type). Best for users who prefer to start
 *                 from the raw variant table.
 *
 * The preference is enforced by `CaseView.loadTypeCounts`. The
 * Shortlist tab itself is still always shown when at least one
 * variant type is present — this only controls which tab is
 * default-active.
 */
export type DefaultCaseTab = 'shortlist' | 'snv'

interface PersistedSettings {
  itemsPerPage: number
  /** Case/cohort tables size their page to the visible table height ("Auto (fit)"); itemsPerPage then holds the last fit size so a reload starts with it. */
  autoFitPageSize: boolean
  userName: string
  workerThreads: number // 0 = auto (cpus - 1)
  prefetchEnabled: boolean
  defaultCaseTab: DefaultCaseTab
  /** 'system' follows prefers-color-scheme (see utils/theme-preference.ts). */
  themePreference: ThemePreference
}

const DEFAULTS: PersistedSettings = {
  itemsPerPage: 25,
  autoFitPageSize: false,
  userName: '',
  workerThreads: 0,
  prefetchEnabled: true,
  defaultCaseTab: 'shortlist',
  themePreference: DEFAULT_THEME_PREFERENCE
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw !== null && raw !== '') {
      const parsed = JSON.parse(raw) as Partial<PersistedSettings>
      const merged = { ...DEFAULTS, ...parsed }
      if (!isThemePreference(merged.themePreference)) {
        merged.themePreference = DEFAULT_THEME_PREFERENCE
      }
      return merged
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
  const autoFitPageSize = ref(persisted.autoFitPageSize)
  const userName = ref(persisted.userName)
  const workerThreads = ref(persisted.workerThreads)
  const prefetchEnabled = ref(persisted.prefetchEnabled)
  const defaultCaseTab = ref<DefaultCaseTab>(persisted.defaultCaseTab)
  const themePreference = ref<ThemePreference>(persisted.themePreference)

  // Auto-persist on change
  watch(
    [
      itemsPerPage,
      autoFitPageSize,
      userName,
      workerThreads,
      prefetchEnabled,
      defaultCaseTab,
      themePreference
    ],
    () => {
      save({
        itemsPerPage: itemsPerPage.value,
        autoFitPageSize: autoFitPageSize.value,
        userName: userName.value,
        workerThreads: workerThreads.value,
        prefetchEnabled: prefetchEnabled.value,
        defaultCaseTab: defaultCaseTab.value,
        themePreference: themePreference.value
      })
    }
  )

  return {
    itemsPerPage,
    autoFitPageSize,
    userName,
    workerThreads,
    prefetchEnabled,
    defaultCaseTab,
    themePreference
  }
})
