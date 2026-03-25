import type { IpcMain } from 'electron'
import type { DatabaseService } from '../database/DatabaseService'
import type { DatabaseManager } from '../services/DatabaseManager'
import type { DbPool } from '../database/DbPool'

/**
 * Dependencies injected into IPC handler registration functions.
 *
 * Replaces direct imports of `ipcMain` and `getDatabaseService`/`getDatabaseManager`
 * in handler modules, making them easier to test and eliminating side-effect registration.
 */
export interface HandlerDependencies {
  ipcMain: IpcMain
  getDb: () => DatabaseService
  getDbManager: () => DatabaseManager
  /** Optional Piscina-based worker pool for off-thread read queries */
  getDbPool?: () => DbPool | null
}
