/**
 * Pinia store for logging infrastructure
 * Manages circular buffer of log entries with configurable size and statistics tracking
 */

import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { LogEntry, LogConfig, LogStatistics } from '../types/log'
import { APP_CONFIG } from '../../../shared/config'

const CONFIG_KEY = 'varlens_log_config'

const DEFAULT_CONFIG: LogConfig = {
  maxEntries: APP_CONFIG.MAX_LOG_ENTRIES,
  minLevel: 'debug'
}

/**
 * Load log configuration from localStorage
 */
function loadConfig(): LogConfig {
  try {
    const stored = localStorage.getItem(CONFIG_KEY)
    if (stored !== null) {
      const parsed = JSON.parse(stored)
      return { ...DEFAULT_CONFIG, ...parsed }
    }
  } catch (error) {
    console.warn('Failed to load log config from localStorage:', error)
  }
  return DEFAULT_CONFIG
}

/**
 * Save log configuration to localStorage
 */
function saveConfig(config: LogConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn('Failed to save log config to localStorage:', error)
  }
}

/**
 * Log store using setup store pattern
 */
export const useLogStore = defineStore('log', () => {
  // State
  const config = ref<LogConfig>(loadConfig())
  const maxEntries = ref(config.value.maxEntries)
  const entries = ref<LogEntry[]>([])
  const stats = ref<LogStatistics>({
    totalReceived: 0,
    totalDropped: 0,
    debugCount: 0,
    infoCount: 0,
    warnCount: 0,
    errorCount: 0,
    criticalCount: 0
  })

  // Computed
  const bufferUsage = computed(() => ({
    current: entries.value.length,
    max: maxEntries.value,
    percentage: (entries.value.length / maxEntries.value) * 100
  }))

  // Actions
  function addEntry(entry: Omit<LogEntry, 'id'>): void {
    // Assign unique ID based on total received count
    const id = stats.value.totalReceived

    // If buffer is full, drop oldest entry
    if (entries.value.length >= maxEntries.value) {
      entries.value.shift()
      stats.value.totalDropped++
    }

    // Add new entry
    entries.value.push({ ...entry, id })

    // Update statistics
    stats.value.totalReceived++

    // Update per-level count using template literal key
    const levelCountKey = `${entry.level}Count` as keyof LogStatistics
    if (typeof stats.value[levelCountKey] === 'number') {
      ;(stats.value[levelCountKey] as number)++
    }
  }

  function clear(): void {
    entries.value = []
    // Keep cumulative stats unchanged
  }

  function setMaxEntries(max: number): void {
    maxEntries.value = max

    // Trim oldest entries if buffer exceeds new max
    if (entries.value.length > max) {
      const dropped = entries.value.length - max
      entries.value = entries.value.slice(dropped)
      stats.value.totalDropped += dropped
    }
  }

  function updateConfig(newConfig: Partial<LogConfig>): void {
    config.value = { ...config.value, ...newConfig }
    saveConfig(config.value)

    // Update maxEntries if changed
    if (newConfig.maxEntries !== undefined) {
      setMaxEntries(newConfig.maxEntries)
    }
  }

  // Watch config changes and persist to localStorage
  watch(
    config,
    (newConfig) => {
      saveConfig(newConfig)
    },
    { deep: true }
  )

  return {
    config,
    maxEntries,
    entries,
    stats,
    bufferUsage,
    addEntry,
    clear,
    setMaxEntries,
    updateConfig
  }
})
