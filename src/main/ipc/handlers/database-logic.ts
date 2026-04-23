/**
 * Pure business logic for database IPC handlers.
 *
 * All functions take explicit dependencies as parameters and never touch
 * IPC/Electron APIs directly. Dialog operations and shell.showItemInFolder
 * remain in the handler layer.
 */
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { extname, resolve } from 'path'
import { mainLogger } from '../../services/MainLogger'
import { WrongPasswordError } from '../../database/errors'
import { convertBigInts } from '../../utils/convertBigInts'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DatabaseManager } from '../../services/DatabaseManager'
import type { DbPool } from '../../database/DbPool'

/** File extensions allowed for database deletion -- prevents accidental non-DB file removal */
const ALLOWED_DB_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3'])

/** Callbacks for pool init and cohort rebuild during database open/create. */
export interface DatabaseLifecycleCallbacks {
  initDbPool: (path: string, password?: string) => Promise<void>
  triggerStartupRebuild: (db: DatabaseService) => void
}

// ============================================================
// Database Lifecycle
// ============================================================

/**
 * Open a database: detect encryption, validate password, switch connection.
 */
export async function openDatabase(
  params: { path: string; password?: string },
  getDb: () => DatabaseService,
  getDbManager: () => DatabaseManager,
  callbacks: DatabaseLifecycleCallbacks
): Promise<{
  success: boolean
  needsPassword?: boolean
  error?: string
  info?: { path: string; name: string; encrypted: boolean }
}> {
  const manager = getDbManager()
  const { path: vPath, password: vPassword } = params

  // First detect if database is encrypted
  const { needsPassword } = manager.openDetectEncryption(vPath)

  // If encrypted and no password provided, return early
  if (needsPassword && (vPassword === undefined || vPassword === '')) {
    return {
      success: false,
      needsPassword: true
    }
  }

  // Switch to new database with rollback on failure
  try {
    await manager.switchDatabase(vPath, vPassword)
    mainLogger.info(`Switched to database: ${vPath}`, 'database')

    // Initialise worker pool for off-thread reads (best effort)
    try {
      await callbacks.initDbPool(vPath, vPassword)
    } catch (e) {
      mainLogger.warn(
        'DbPool init failed -- reads will use main thread: ' +
          (e instanceof Error ? e.message : String(e)),
        'database'
      )
    }

    // Trigger async cohort summary rebuild if needed (non-blocking)
    try {
      callbacks.triggerStartupRebuild(getDb())
    } catch (e) {
      mainLogger.warn(
        'triggerStartupRebuildIfNeeded failed (best effort -- database open continues): ' +
          (e instanceof Error ? e.message : String(e)),
        'database'
      )
    }

    const info = manager.getCurrentInfo()
    return { success: true, info: info! }
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      return { success: false, error: 'WRONG_PASSWORD' }
    }
    throw error
  }
}

/**
 * Create a new database at the specified path.
 */
export async function createDatabase(
  params: { path: string; password?: string },
  getDbManager: () => DatabaseManager,
  callbacks: Pick<DatabaseLifecycleCallbacks, 'initDbPool'>
): Promise<{ success: boolean; info: { path: string; name: string; encrypted: boolean } }> {
  const manager = getDbManager()
  await manager.createDatabase(params.path, params.password)

  // Initialise worker pool (best effort)
  try {
    await callbacks.initDbPool(params.path, params.password)
  } catch (e) {
    mainLogger.warn(
      'DbPool init failed -- reads will use main thread: ' +
        (e instanceof Error ? e.message : String(e)),
      'database'
    )
  }

  const info = manager.getCurrentInfo()
  return { success: true, info: info! }
}

/**
 * Change the encryption key for the current database.
 */
export function rekeyDatabase(
  newPassword: string,
  getDbManager: () => DatabaseManager
): { success: boolean } {
  const manager = getDbManager()
  manager.rekey(newPassword)
  return { success: true }
}

// ============================================================
// Database Info
// ============================================================

export function getDatabaseInfo(
  getDbManager: () => DatabaseManager
): { path: string; name: string; encrypted: boolean } | null {
  const manager = getDbManager()
  return manager.getCurrentInfo()
}

export function getRecentDatabases(getDbManager: () => DatabaseManager): unknown {
  const manager = getDbManager()
  return manager.getRecentDatabases()
}

export async function getDatabaseOverview(
  getDb: () => DatabaseService,
  getDbPool?: () => DbPool | null
): Promise<unknown> {
  const pool = getDbPool?.()
  if (pool) {
    return await pool.run({ type: 'database:overview', params: [] })
  }
  const db = getDb()
  const overview = db.overview.getDatabaseOverview()
  return convertBigInts(overview)
}

// ============================================================
// Recent Database Management
// ============================================================

export function removeRecentDatabase(
  path: string,
  getDbManager: () => DatabaseManager
): { success: boolean } {
  const manager = getDbManager()
  manager.removeRecentDatabase(path)
  mainLogger.info(`Removed from recent databases: ${path}`, 'database')
  return { success: true }
}

/**
 * Delete a database file from disk and remove from recent list.
 * Refuses to delete the currently active database.
 */
export async function deleteDbFile(
  path: string,
  getDbManager: () => DatabaseManager
): Promise<{ success: boolean }> {
  // Canonicalize to resolve any ../ segments (defense-in-depth)
  const canonicalPath = resolve(path)

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
    // File already gone -- just remove from recent list
    manager.removeRecentDatabase(canonicalPath)
    return { success: true }
  }

  // Delete the main database file -- failure here is fatal (return error)
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
}
