/**
 * DbPool lifecycle manager — separated from index.ts to avoid circular imports
 * (database handler imports initDbPool, index.ts imports database handler).
 */

import { DbPool } from '../database/DbPool'
import { mainLogger } from '../services/MainLogger'

/** Singleton DbPool instance — created lazily when a database is opened */
let dbPool: DbPool | null = null

/**
 * Get the current DbPool instance (or null if not yet initialised).
 */
export function getDbPool(): DbPool | null {
  return dbPool
}

/**
 * Initialise (or re-initialise) the Piscina worker pool for the current database.
 *
 * Called from database:open / database:create handlers after a DatabaseService
 * is available. Destroys any previous pool before creating a new one.
 */
export async function initDbPool(dbPath: string, encryptionKey?: string): Promise<void> {
  await destroyDbPool()
  dbPool = new DbPool()
  dbPool.init(dbPath, encryptionKey)
  mainLogger.info('DbPool initialized for worker-thread reads', 'ipc')
}

/**
 * Destroy the current DbPool (if any). Called on database close/switch.
 */
export async function destroyDbPool(): Promise<void> {
  if (dbPool) {
    await dbPool.destroy()
    dbPool = null
  }
}
