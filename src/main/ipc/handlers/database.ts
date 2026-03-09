/**
 * Database IPC handlers - Lifecycle operations for database management
 *
 * Exposes database open/close/switch/create/rekey operations to renderer.
 * Handles encryption detection and password validation.
 */

import { dialog } from 'electron'
import { WrongPasswordError } from '../../database/errors'
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import {
  DatabaseOpenSchema,
  DatabaseCreateSchema,
  DatabaseRekeySchema,
  FilePathSchema
} from '../../../shared/types/ipc-schemas'

export function registerDatabaseHandlers({
  ipcMain,
  getDb,
  getDbManager
}: HandlerDependencies): void {
  /**
   * Show file picker for selecting database file
   */
  ipcMain.handle('database:selectFile', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Database',
      properties: ['openFile'],
      filters: [
        { name: 'Database Files', extensions: ['sqlite', 'db', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  /**
   * Show file picker for selecting save location for new database
   */
  ipcMain.handle('database:selectSaveLocation', async (_event, defaultName: unknown) => {
    // ANTI-07: Runtime validation at IPC boundary
    const validated = FilePathSchema.safeParse(defaultName)
    if (!validated.success) {
      mainLogger.error(
        `Invalid database:selectSaveLocation defaultName: ${validated.error.message}`,
        'database'
      )
      throw new Error('Invalid file name')
    }
    const result = await dialog.showSaveDialog({
      title: 'Create New Database',
      defaultPath: validated.data,
      filters: [
        { name: 'Database Files', extensions: ['sqlite', 'db'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return null
    }

    return result.filePath
  })

  /**
   * Open a database at the specified path
   *
   * Detects encryption and requests password if needed.
   * Validates password if provided.
   */
  ipcMain.handle('database:open', async (_event, path: unknown, password?: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = DatabaseOpenSchema.safeParse({ path, password })
      if (!validated.success) {
        mainLogger.error(`Invalid database:open params: ${validated.error.message}`, 'database')
        throw new Error('Invalid database open parameters')
      }

      const manager = getDbManager()
      const vPath = validated.data.path
      const vPassword = validated.data.password

      // First detect if database is encrypted
      const { needsPassword } = manager.openDetectEncryption(vPath)

      // If encrypted and no password provided, return early
      if (needsPassword && (vPassword === undefined || vPassword === '')) {
        return {
          success: false,
          needsPassword: true
        }
      }

      // Try to open with password (or without if plaintext)
      try {
        manager.open(vPath, vPassword)
        const info = manager.getCurrentInfo()
        return {
          success: true,
          info: info!
        }
      } catch (error) {
        if (error instanceof WrongPasswordError) {
          return {
            success: false,
            error: 'WRONG_PASSWORD'
          }
        }
        throw error
      }
    })
  })

  /**
   * Create a new database at the specified path
   */
  ipcMain.handle('database:create', async (_event, path: unknown, password?: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = DatabaseCreateSchema.safeParse({ path, password })
      if (!validated.success) {
        mainLogger.error(`Invalid database:create params: ${validated.error.message}`, 'database')
        throw new Error('Invalid database create parameters')
      }

      const manager = getDbManager()
      manager.createDatabase(validated.data.path, validated.data.password)

      const info = manager.getCurrentInfo()
      return {
        success: true,
        info: info!
      }
    })
  })

  /**
   * Change the encryption key for the current database
   */
  ipcMain.handle('database:rekey', async (_event, newPassword: unknown) => {
    return wrapHandler(async () => {
      // ANTI-07: Runtime validation at IPC boundary
      const validated = DatabaseRekeySchema.safeParse({ newPassword })
      if (!validated.success) {
        mainLogger.error(`Invalid database:rekey params: ${validated.error.message}`, 'database')
        throw new Error('Invalid encryption key')
      }

      const manager = getDbManager()
      manager.rekey(validated.data.newPassword)

      return { success: true }
    })
  })

  /**
   * Get information about the current database
   */
  ipcMain.handle('database:info', async () => {
    return wrapHandler(async () => {
      const manager = getDbManager()
      return manager.getCurrentInfo()
    })
  })

  /**
   * Get the list of recent databases
   */
  ipcMain.handle('database:recentList', async () => {
    return wrapHandler(async () => {
      const manager = getDbManager()
      return manager.getRecentDatabases()
    })
  })

  /**
   * Get database overview (summary stats, cases, cohorts, tags, phenotypes)
   */
  ipcMain.handle('database:overview', async () => {
    return wrapHandler(async () => {
      const db = getDb()
      const overview = db.overview.getDatabaseOverview()
      // Deep clone for IPC serialization (handle BigInt)
      return JSON.parse(
        JSON.stringify(overview, (_key, value) =>
          typeof value === 'bigint' ? Number(value) : value
        )
      )
    })
  })

  mainLogger.info('Database IPC handlers registered', 'database')
}
