/**
 * Pure business logic for the SQLite database lifecycle: open, create,
 * rekey, and read current-session info/capabilities/diagnostics.
 *
 * Split out of `database-logic.ts` (which now covers PostgreSQL profile
 * management, recent-database bookkeeping, and file deletion) to keep both
 * files under the repo's LLM-sustainable size guideline. Re-exported from
 * `database-logic.ts` so it stays the single stable import surface for
 * handlers and tests -- see the `createPostgresStorageSession` re-export
 * there for the same pattern.
 */
import { mainLogger } from '../../services/MainLogger'
import { WrongPasswordError } from '../../database/errors'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DatabaseManager } from '../../services/DatabaseManager'
import type { DbKeyStoreLike } from '../../database/db-key-store'
import type { DatabaseInfo, DatabaseOpenResult } from '../../../shared/ipc/domains/database'
import type { StorageCapabilities } from '../../../shared/types/storage-capabilities'
import type { PostgresHealthDiagnosticResult } from '../../../shared/types/postgres-profile'

/** Callbacks for pool init and cohort rebuild during database open/create. */
export interface DatabaseLifecycleCallbacks {
  triggerStartupRebuild: (db: DatabaseService) => void
}

/** Params accepted by `createDatabase`. See task-I2a-brief.md for the 3-path design. */
export interface DatabaseCreateParams {
  path: string
  /** Legacy/advanced explicit password: used directly as the SQLCipher key, unchanged. */
  password?: string
  /**
   * First-run passphrase-setup completion (only used when a prior create call
   * returned `needsPassphraseSetup`). Wraps a freshly generated random DEK --
   * the passphrase itself never becomes the SQLCipher key.
   */
  setupPassphrase?: string
}

/**
 * Open a database: detect encryption, resolve/validate a key, switch connection.
 *
 * Resolution order when the target is encrypted and no explicit password is
 * supplied: try the key-store's managed (safeStorage-wrapped) key first --
 * transparent, no prompt. If that can't resolve (moved machine, no keyring
 * entry), fall back to the existing `needsPassword` prompt flow. When the
 * caller later supplies a password, it is tried as a key-store passphrase
 * first (for a managed DB whose safeStorage wrap can't resolve here), then
 * as a direct SQLCipher key (today's explicit-password behavior, unchanged).
 */
export async function openDatabase(
  params: { path: string; password?: string },
  getDb: () => DatabaseService,
  getDbManager: () => DatabaseManager,
  callbacks: DatabaseLifecycleCallbacks,
  keyStore: DbKeyStoreLike
): Promise<DatabaseOpenResult> {
  const manager = getDbManager()
  const { path: vPath, password: vPassword } = params

  // First detect if database is encrypted
  const { needsPassword } = manager.openDetectEncryption(vPath)

  let effectiveKey = vPassword

  if (needsPassword) {
    if (vPassword === undefined || vPassword === '') {
      const resolved = keyStore.resolveKeyForPath(vPath)
      if (!resolved.ok) {
        return { success: false, needsPassword: true }
      }
      effectiveKey = resolved.dek
    } else {
      const resolved = keyStore.resolveKeyWithPassphrase(vPath, vPassword)
      effectiveKey = resolved.ok ? resolved.dek : vPassword
    }
  }

  // Switch to new database with rollback on failure
  try {
    await manager.switchDatabase(vPath, effectiveKey)
    mainLogger.info(`Switched to database: ${vPath}`, 'database')

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

/** Generic "don't silently create an unencrypted DB" failure for a key-store conflict. */
const PATH_ALREADY_KEYED_ERROR =
  'This database path already has a registered encryption key. Choose a different location.'

/**
 * Create a new database at the specified path.
 *
 * Three paths (see task-I2a-brief.md):
 * - Explicit `password` -- unchanged legacy behavior: the password IS the
 *   SQLCipher key directly. The key-store is never consulted.
 * - `setupPassphrase` -- completes the safeStorage-unavailable fallback:
 *   wraps a freshly generated random DEK with the passphrase and uses the
 *   DEK (not the passphrase) as the key.
 * - Neither supplied -- encrypt-by-default: mint a managed (safeStorage-
 *   wrapped) key transparently. If safeStorage is unavailable, return
 *   `needsPassphraseSetup` instead of silently creating an unencrypted DB.
 */
export async function createDatabase(
  params: DatabaseCreateParams,
  getDbManager: () => DatabaseManager,
  keyStore: DbKeyStoreLike
): Promise<DatabaseOpenResult> {
  const manager = getDbManager()

  if (params.password !== undefined && params.password !== '') {
    await manager.createDatabase(params.path, params.password)
    const info = manager.getCurrentInfo()
    return { success: true, info: info! }
  }

  if (params.setupPassphrase !== undefined && params.setupPassphrase !== '') {
    const wrapped = keyStore.wrapNewDekWithPassphrase(params.path, params.setupPassphrase)
    if (!wrapped.ok) {
      return { success: false, error: PATH_ALREADY_KEYED_ERROR }
    }
    try {
      await manager.createDatabase(params.path, wrapped.dek)
    } catch (error) {
      // The registry entry was written before the DB file exists. If creation
      // fails (disk full, permission error, path collision), roll it back so
      // the path isn't permanently burned -- a retry must be able to mint a
      // fresh key for the same path instead of hitting `path-already-keyed`.
      keyStore.removeKey(wrapped.keyId)
      throw error
    }
    const info = manager.getCurrentInfo()
    return { success: true, info: info! }
  }

  const managed = keyStore.createManagedKey(params.path)
  if (managed.ok) {
    try {
      await manager.createDatabase(params.path, managed.dek)
    } catch (error) {
      // Same rollback as the passphrase path above: don't leave a stale
      // key-store entry when the DB file was never actually created.
      keyStore.removeKey(managed.keyId)
      throw error
    }
    const info = manager.getCurrentInfo()
    return { success: true, info: info! }
  }

  if (managed.reason === 'safe-storage-unavailable') {
    return { success: false, needsPassphraseSetup: true }
  }

  // path-already-keyed: never silently fall back to an unencrypted DB.
  return { success: false, error: PATH_ALREADY_KEYED_ERROR }
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

export function getDatabaseInfo(getDbManager: () => DatabaseManager): DatabaseInfo | null {
  const manager = getDbManager()
  return manager.getCurrentInfo()
}

export function getDatabaseCapabilities(getDbManager: () => DatabaseManager): StorageCapabilities {
  return getDbManager().getCurrentSession().capabilities
}

export async function getPostgresDiagnostics(
  getDbManager: () => DatabaseManager
): Promise<PostgresHealthDiagnosticResult> {
  const session = getDbManager().getCurrentSession()
  if (session.capabilities.backend !== 'postgres' || session.workspace.kind !== 'postgres') {
    return {
      ok: false,
      schema: '',
      message: 'PostgreSQL diagnostics are only available for PostgreSQL sessions'
    }
  }

  const collectDiagnostics = (
    session as {
      collectDiagnostics?: () => Promise<PostgresHealthDiagnosticResult>
    }
  ).collectDiagnostics
  if (collectDiagnostics !== undefined) {
    return await collectDiagnostics.call(session)
  }

  return {
    ok: false,
    schema: session.workspace.schema,
    message: 'Current PostgreSQL session does not expose diagnostics'
  }
}
