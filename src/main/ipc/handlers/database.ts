/**
 * Database IPC handlers - Lifecycle operations for database management
 *
 * Exposes database open/close/switch/create/rekey operations to renderer.
 * Handles encryption detection and password validation.
 */

import { ipcMain, dialog } from 'electron'
import { getDatabaseManager, getDatabaseService } from '../../database'
import { WrongPasswordError } from '../../database/errors'
import { wrapHandler } from '../errorHandler'
import { mainLogger } from '../../services/MainLogger'

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
ipcMain.handle('database:selectSaveLocation', async (_event, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    title: 'Create New Database',
    defaultPath: defaultName,
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
ipcMain.handle('database:open', async (_event, path: string, password?: string) => {
  return wrapHandler(async () => {
    const manager = getDatabaseManager()

    // First detect if database is encrypted
    const { needsPassword } = manager.openDetectEncryption(path)

    // If encrypted and no password provided, return early
    if (needsPassword && (password === undefined || password === '')) {
      return {
        success: false,
        needsPassword: true
      }
    }

    // Try to open with password (or without if plaintext)
    try {
      manager.open(path, password)
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
ipcMain.handle('database:create', async (_event, path: string, password?: string) => {
  return wrapHandler(async () => {
    const manager = getDatabaseManager()
    manager.createDatabase(path, password)

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
ipcMain.handle('database:rekey', async (_event, newPassword: string) => {
  return wrapHandler(async () => {
    const manager = getDatabaseManager()
    manager.rekey(newPassword)

    return { success: true }
  })
})

/**
 * Get information about the current database
 */
ipcMain.handle('database:info', async () => {
  return wrapHandler(async () => {
    const manager = getDatabaseManager()
    return manager.getCurrentInfo()
  })
})

/**
 * Get the list of recent databases
 */
ipcMain.handle('database:recentList', async () => {
  return wrapHandler(async () => {
    const manager = getDatabaseManager()
    return manager.getRecentDatabases()
  })
})

/**
 * Get database overview (summary stats, cases, cohorts, tags, phenotypes)
 */
ipcMain.handle('database:overview', async () => {
  return wrapHandler(async () => {
    const db = getDatabaseService()
    const overview = db.overview.getDatabaseOverview()
    // Deep clone for IPC serialization (handle BigInt)
    return JSON.parse(
      JSON.stringify(overview, (_key, value) => (typeof value === 'bigint' ? Number(value) : value))
    )
  })
})

mainLogger.info('Database IPC handlers registered', 'database')
