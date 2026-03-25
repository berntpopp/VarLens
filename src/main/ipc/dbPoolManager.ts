/**
 * DbPool lifecycle manager — separated from index.ts to avoid circular imports
 * (database handler imports initDbPool, index.ts imports database handler).
 */

import { DbPool } from '../database/DbPool'
import { mainLogger } from '../services/MainLogger'

/** Singleton DbPool instance — created lazily when a database is opened */
let dbPool: DbPool | null = null

/**
 * User-configured worker thread count.
 * 0 = auto (cpus - 1). Set via system:setWorkerThreads IPC.
 * Applied on the next initDbPool() call.
 */
let configuredWorkerThreads = 0

/**
 * Get the current DbPool instance (or null if not yet initialised).
 */
export function getDbPool(): DbPool | null {
  return dbPool
}

/**
 * Set the desired worker thread count (0 = auto).
 * Takes effect on the next initDbPool() call.
 */
export function setWorkerThreads(count: number): void {
  configuredWorkerThreads = Math.max(0, Math.floor(count))
}

/**
 * Get the current configured worker thread count.
 */
export function getWorkerThreads(): number {
  return configuredWorkerThreads
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
  const maxThreads = configuredWorkerThreads > 0 ? configuredWorkerThreads : undefined
  dbPool.init(dbPath, encryptionKey, maxThreads !== undefined ? { maxThreads } : undefined)
  mainLogger.info(
    `DbPool initialized for worker-thread reads (threads: ${maxThreads ?? 'auto'})`,
    'ipc'
  )
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
