import type { IpcMain } from 'electron'
import type { DatabaseService } from '../database/DatabaseService'
import type { DatabaseManager } from '../services/DatabaseManager'
import type {
  DbKeyStoreWithPassphraseLike,
  DbKeyStoreWithRecoveryLike
} from '../database/db-key-store'
import type { DbPool } from '../database/DbPool'
import type { PostgresPoolLike, PostgresProfileStoreLike } from './handlers/database-logic'
import type { PostgresStorageConfig } from '../storage/config'
import type { StorageSession } from '../storage/session'
import type { PostgresHealthDiagnosticResult } from '../../shared/types/postgres-profile'

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
  /** Optional PostgreSQL profile store factory for hosted workspace profile IPC. */
  getPostgresProfileStore?: () => PostgresProfileStoreLike
  /**
   * Optional DB key-store factory so tests can inject a fake registry/safeStorage.
   * Widened to include `setPassphrase` (task I2b's plaintext-migration orchestration
   * needs it) and the recovery-sidecar surface `openDatabase` needs
   * (`resolveKeyWithPassphraseFromSidecar`, `findManagedKeyIdForDek`,
   * `enrollRecoveredKey`, …) -- the same accessor feeds `openDatabase`,
   * `createDatabase`, and `migrateCurrentToEncrypted`, so it must satisfy all
   * three narrower `DbKeyStore*Like` types at once. The real singleton
   * (`DbKeyStore`) always implements the full surface.
   */
  getDbKeyStore?: () => DbKeyStoreWithPassphraseLike & DbKeyStoreWithRecoveryLike
  /** Optional PostgreSQL pool factory so tests can avoid a real server. */
  createPostgresPool?: (config: PostgresStorageConfig) => PostgresPoolLike
  /** Optional PostgreSQL session factory so tests can avoid building repository graph. */
  createPostgresSession?: (
    config: PostgresStorageConfig
  ) => Promise<StorageSession> | StorageSession
  /** Optional PostgreSQL migration runner hook for tests. */
  migratePostgres?: (pool: PostgresPoolLike, schema: string) => Promise<void>
  /** Optional PostgreSQL diagnostics hook for tests. */
  collectPostgresDiagnostics?: (
    pool: PostgresPoolLike,
    schema: string
  ) => Promise<PostgresHealthDiagnosticResult>
}
