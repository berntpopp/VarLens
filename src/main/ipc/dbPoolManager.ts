/**
 * DbPool resolution and worker-thread setting — separated from index.ts to avoid
 * circular imports. The pool itself is owned by the active SqliteStorageSession.
 */

import type { DbPool } from '../database/DbPool'
import type { StorageSession } from '../storage/session'

type DbPoolSource = {
  capabilities: Pick<StorageSession['capabilities'], 'backend'>
  // Concrete-class method on SqliteStorageSession; no longer on the
  // sealed StorageSession interface (see src/main/storage/session.ts).
  getDbPool(): DbPool | null
}
let getActiveSession: (() => StorageSession | null) | null = null

function hasDbPoolSource(session: StorageSession): session is StorageSession & DbPoolSource {
  return 'getDbPool' in session && typeof session.getDbPool === 'function'
}

/**
 * User-configured worker thread count.
 * 0 = auto (cpus - 1). Set via system:setWorkerThreads IPC.
 * Applied when the next SQLite session creates its pool.
 */
let configuredWorkerThreads = 0

/**
 * The active SQLite session's DbPool, or null (no session, PostgreSQL, or no pool).
 */
export function getDbPool(): DbPool | null {
  const activeSession = getActiveSession?.() ?? null

  if (activeSession === null || activeSession.capabilities.backend === 'postgres') {
    return null
  }

  return hasDbPoolSource(activeSession) ? activeSession.getDbPool() : null
}

export function setActiveSessionResolver(resolver: () => StorageSession | null): void {
  getActiveSession = resolver
}

/**
 * Set the desired worker thread count (0 = auto).
 * Takes effect when the next SQLite session is opened.
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
