/**
 * RecentDatabasesService - Manages recent database list persistence
 *
 * Stores recent database list in varlens-settings.json in userData directory.
 * Uses simple JSON file approach (same pattern as import handler settings).
 */

import { readFileSync, writeFileSync } from 'fs'
import { basename } from 'path'
import { DATABASE_CONFIG } from '../../shared/config'
import { mainLogger } from './MainLogger'

/**
 * Recent database entry
 */
export interface RecentDatabase {
  path: string
  name: string
  lastOpened: number
}

/**
 * Settings file structure
 */
interface SettingsData {
  recentDatabases: RecentDatabase[]
}

/**
 * Service for managing recent databases list
 */
export class RecentDatabasesService {
  private readonly maxRecent = DATABASE_CONFIG.MAX_RECENT_DATABASES
  private readonly settingsPath: string

  /**
   * Create a RecentDatabasesService
   *
   * @param settingsPath - Path to varlens-settings.json file
   */
  constructor(settingsPath: string) {
    this.settingsPath = settingsPath
  }

  /**
   * Add a database to the recent list
   *
   * Removes any existing entry for the same path, then adds to the top.
   * Limits list to maxRecent entries.
   *
   * @param dbPath - Path to the database file
   */
  addRecent(dbPath: string): void {
    const data = this.load()
    const name = basename(dbPath)
    const timestamp = Date.now()

    // Remove existing entry for this path
    data.recentDatabases = data.recentDatabases.filter((entry) => entry.path !== dbPath)

    // Add to front
    data.recentDatabases.unshift({
      path: dbPath,
      name,
      lastOpened: timestamp
    })

    // Trim to max size
    if (data.recentDatabases.length > this.maxRecent) {
      data.recentDatabases = data.recentDatabases.slice(0, this.maxRecent)
    }

    this.save(data)
  }

  /**
   * Get the recent databases list
   *
   * @returns Array of recent databases, newest first
   */
  getRecent(): RecentDatabase[] {
    const data = this.load()
    return data.recentDatabases
  }

  /**
   * Remove a database from the recent list
   *
   * @param dbPath - Path to the database file to remove
   */
  removeRecent(dbPath: string): void {
    const data = this.load()
    data.recentDatabases = data.recentDatabases.filter((entry) => entry.path !== dbPath)
    this.save(data)
  }

  /**
   * Load settings from file
   *
   * @returns Settings data (empty structure if file doesn't exist)
   */
  private load(): SettingsData {
    try {
      const json = readFileSync(this.settingsPath, 'utf-8')
      const data = JSON.parse(json)
      // Validate structure — ensure recentDatabases is an array
      if (!Array.isArray(data?.recentDatabases)) {
        return { recentDatabases: [] }
      }
      // Sanitize entries — ensure each has the expected shape
      const recentDatabases: RecentDatabase[] = data.recentDatabases.filter(
        (entry: unknown): entry is RecentDatabase => {
          if (entry === null || typeof entry !== 'object') return false
          const e = entry as { path?: unknown; name?: unknown; lastOpened?: unknown }
          return (
            typeof e.path === 'string' &&
            typeof e.name === 'string' &&
            typeof e.lastOpened === 'number'
          )
        }
      )
      return { recentDatabases }
    } catch (e) {
      mainLogger.warn(
        'Failed to load recent databases settings (file may not exist): ' +
          (e instanceof Error ? e.message : String(e)),
        'RecentDatabasesService'
      )
      return { recentDatabases: [] }
    }
  }

  /**
   * Save settings to file
   *
   * @param data - Settings data to save
   */
  private save(data: SettingsData): void {
    try {
      const json = JSON.stringify(data, null, 2)
      writeFileSync(this.settingsPath, json, 'utf-8')
    } catch (error) {
      // Non-fatal - recent list not critical to app function.
      // Log best-effort (mainLogger may not be available in tests).
      try {
        mainLogger.warn(
          `Failed to save recent databases: ${error instanceof Error ? error.message : String(error)}`,
          'database'
        )
      } catch (logError) {
        console.warn(
          '[RecentDatabasesService] Failed to save recent databases and logging unavailable:',
          logError instanceof Error ? logError.message : String(logError)
        )
      }
    }
  }
}
