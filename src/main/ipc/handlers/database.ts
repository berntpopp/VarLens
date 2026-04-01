/**
 * Database IPC handlers - Lifecycle operations for database management
 *
 * Exposes database open/close/switch/create/rekey operations to renderer.
 * Handles encryption detection and password validation.
 */

import { dialog, shell } from 'electron'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { extname, resolve } from 'path'
import { WrongPasswordError } from '../../database/errors'

/** File extensions allowed for database deletion — prevents accidental non-DB file removal */
const ALLOWED_DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3'])
import { wrapHandler } from '../errorHandler'
import type { HandlerDependencies } from '../types'
import { mainLogger } from '../../services/MainLogger'
import { convertBigInts } from '../../utils/convertBigInts'
import {
  DatabaseOpenSchema,
  DatabaseCreateSchema,
  DatabaseRekeySchema,
  FilePathSchema
} from '../../../shared/types/ipc-schemas'
import { triggerStartupRebuildIfNeeded } from './cohort'
import { initDbPool } from '../dbPoolManager'

export function registerDatabaseHandlers({
  ipcMain,
  getDb,
  getDbManager,
  getDbPool
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

      // Switch to new database with rollback on failure.
      // switchDatabase() preserves the previous connection if the new one fails.
      try {
        manager.switchDatabase(vPath, vPassword)
        mainLogger.info(`Switched to database: ${vPath}`, 'database')
        // Initialise worker pool for off-thread reads (best effort)
        try {
          await initDbPool(vPath, vPassword)
        } catch (e) {
          mainLogger.warn(
            'DbPool init failed — reads will use main thread: ' +
              (e instanceof Error ? e.message : String(e)),
            'database'
          )
        }
        // Trigger async cohort summary rebuild if needed (non-blocking)
        try {
          triggerStartupRebuildIfNeeded(getDb())
        } catch (e) {
          mainLogger.warn(
            'triggerStartupRebuildIfNeeded failed (best effort — database open continues): ' +
              (e instanceof Error ? e.message : String(e)),
            'database'
          )
        }
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

      // Initialise worker pool for off-thread reads (best effort)
      try {
        await initDbPool(validated.data.path, validated.data.password)
      } catch (e) {
        mainLogger.warn(
          'DbPool init failed — reads will use main thread: ' +
            (e instanceof Error ? e.message : String(e)),
          'database'
        )
      }

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
      const pool = getDbPool?.()
      if (pool) {
        return await pool.run({ type: 'database:overview', params: [] })
      }

      const db = getDb()
      const overview = db.overview.getDatabaseOverview()
      // Deep clone for IPC serialization (handle BigInt)
      return convertBigInts(overview)
    })
  })

  /**
   * Remove a database from the recent list (does not delete the file)
   */
  ipcMain.handle('database:removeRecent', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        mainLogger.error(
          `Invalid database:removeRecent path: ${validated.error.message}`,
          'database'
        )
        throw new Error('Invalid file path')
      }

      const manager = getDbManager()
      manager.removeRecentDatabase(validated.data)
      mainLogger.info(`Removed from recent databases: ${validated.data}`, 'database')
      return { success: true }
    })
  })

  /**
   * Delete a database file from disk and remove from recent list.
   * Refuses to delete the currently active database.
   */
  ipcMain.handle('database:deleteFile', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        mainLogger.error(`Invalid database:deleteFile path: ${validated.error.message}`, 'database')
        throw new Error('Invalid file path')
      }

      // Canonicalize to resolve any ../ segments (defense-in-depth)
      const canonicalPath = resolve(validated.data)

      // Only allow deletion of known database file extensions
      const ext = extname(canonicalPath).toLowerCase()
      if (!ALLOWED_DB_EXTENSIONS.has(ext)) {
        throw new Error(
          `Refusing to delete file with extension "${ext}". Only database files (.db, .sqlite, .sqlite3) can be deleted.`
        )
      }

      const manager = getDbManager()

      // Verify the path exists in the recent databases list before allowing deletion
      const recentPaths = manager.getRecentDatabases().map((db) => db.path)
      if (!recentPaths.includes(canonicalPath)) {
        throw new Error('Can only delete databases that appear in the recent databases list.')
      }

      const currentPath = manager.getCurrentPath()

      // Refuse to delete the currently active database
      if (currentPath === canonicalPath) {
        throw new Error(
          'Cannot delete the currently active database. Switch to a different database first.'
        )
      }

      if (!existsSync(canonicalPath)) {
        // File already gone — just remove from recent list
        manager.removeRecentDatabase(canonicalPath)
        return { success: true }
      }

      // Delete the main database file — failure here is fatal (return error)
      try {
        await unlink(canonicalPath)
      } catch (e) {
        mainLogger.error(
          `Failed to delete database file ${canonicalPath}: ${e instanceof Error ? e.message : String(e)}`,
          'database'
        )
        throw e
      }

      // Best-effort cleanup of WAL/SHM companion files
      for (const suffix of ['-wal', '-shm']) {
        const filePath = canonicalPath + suffix
        if (existsSync(filePath)) {
          try {
            await unlink(filePath)
          } catch (e) {
            mainLogger.warn(
              `Failed to delete ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
              'database'
            )
          }
        }
      }

      manager.removeRecentDatabase(canonicalPath)
      mainLogger.info(`Deleted database file: ${canonicalPath}`, 'database')
      return { success: true }
    })
  })

  /**
   * Reveal a database file in the system file manager
   */
  ipcMain.handle('database:showInFolder', async (_event, path: unknown) => {
    return wrapHandler(async () => {
      const validated = FilePathSchema.safeParse(path)
      if (!validated.success) {
        throw new Error('Invalid file path')
      }
      shell.showItemInFolder(validated.data)
      return { success: true }
    })
  })

  mainLogger.info('Database IPC handlers registered', 'database')
}
