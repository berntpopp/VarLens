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
import { DatabaseError, WrongPasswordError } from '../../database/errors'
import type { DatabaseService } from '../../database/DatabaseService'
import type { DatabaseManager } from '../../services/DatabaseManager'
import type {
  DbKeyStoreLike,
  DbKeyStoreWithPassphraseLike,
  DbKeyStoreWithRecoveryLike,
  PassphraseWrap
} from '../../database/db-key-store'
import { readRecoverySidecar, recoverySidecarExists } from '../../database/recovery-sidecar'
import type {
  DatabaseInfo,
  DatabaseOpenResult,
  SetRecoveryPassphraseResult
} from '../../../shared/ipc/domains/database'
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

/** Outcome of resolving a user-supplied password/passphrase attempt. */
type PasswordResolution = { kind: 'resolved'; dek: string } | { kind: 'wrong-passphrase' }

/**
 * After a successful sidecar-based passphrase recovery, make future opens at
 * `vPath` transparent on THIS machine: repoint an existing LOCAL entry for
 * the SAME DEK (the "same-machine move" case -- the `.db` file, plus its
 * sidecar, moved to a new path on a machine that already has a keyring entry
 * for that exact DEK under the old, now-stale path) rather than minting a
 * redundant, orphaned key. Otherwise enroll a brand-new entry from the
 * sidecar's wrap so a genuinely new/wiped machine also becomes transparent
 * next time. Never fails the open itself -- a failure to enroll here is
 * logged and the caller proceeds with the already-recovered `dek`.
 */
function enrollOrRepointSidecarRecovery(
  vPath: string,
  dek: string,
  passWrap: PassphraseWrap,
  keyStore: DbKeyStoreWithRecoveryLike
): void {
  const existingKeyId = keyStore.findManagedKeyIdForDek(dek)
  if (existingKeyId !== null) {
    keyStore.updatePath(existingKeyId, vPath)
    return
  }

  const enrolled = keyStore.enrollRecoveredKey(vPath, dek, passWrap)
  if (!enrolled.ok) {
    // Defensive only: step 1 (resolveKeyWithPassphrase) already failed to
    // resolve this exact path, so `path-already-keyed` here would mean
    // someone else enrolled it concurrently. Not fatal to this open.
    mainLogger.warn(
      `Recovered a database via its portable recovery sidecar, but enrolling a local key ` +
        `entry failed (${enrolled.reason}); this open proceeds, but future opens on this ` +
        `machine may prompt for the passphrase again.`,
      'database'
    )
  }
}

/**
 * Resolve a supplied password/passphrase attempt against, in order: the
 * key-store's own passphrase wrap for this exact path (unchanged today's
 * behavior), then a portable recovery sidecar next to the database file
 * (self-healing the registry on success -- see
 * `enrollOrRepointSidecarRecovery`), then the legacy fallback of treating the
 * supplied value as a raw SQLCipher key. A wrong passphrase against a
 * genuine sidecar is a typed failure -- it never falls through to being
 * treated as a raw key.
 */
function resolvePasswordAttempt(
  vPath: string,
  vPassword: string,
  keyStore: DbKeyStoreWithRecoveryLike
): PasswordResolution {
  const viaRegistry = keyStore.resolveKeyWithPassphrase(vPath, vPassword)
  if (viaRegistry.ok) {
    return { kind: 'resolved', dek: viaRegistry.dek }
  }

  if (recoverySidecarExists(vPath)) {
    const sidecar = readRecoverySidecar(vPath)
    if (sidecar !== null) {
      const viaSidecar = keyStore.resolveKeyWithPassphraseFromSidecar(sidecar.passWrap, vPassword)
      if (!viaSidecar.ok) {
        return { kind: 'wrong-passphrase' }
      }
      enrollOrRepointSidecarRecovery(vPath, viaSidecar.dek, sidecar.passWrap, keyStore)
      return { kind: 'resolved', dek: viaSidecar.dek }
    }
  }

  // No registry entry and no (parseable) sidecar at this path: legacy
  // fallback -- treat the supplied value as a raw SQLCipher key, unchanged.
  return { kind: 'resolved', dek: vPassword }
}

/**
 * Open a database: detect encryption, resolve/validate a key, switch connection.
 *
 * Resolution order when the target is encrypted and no explicit password is
 * supplied: try the key-store's managed (safeStorage-wrapped) key first --
 * transparent, no prompt. If that can't resolve (moved machine, no keyring
 * entry), fall back to the existing `needsPassword` prompt flow -- a
 * portable recovery sidecar alone is never enough without a passphrase, so
 * this branch doesn't need to know it exists.
 *
 * When the caller supplies a password/passphrase attempt, see
 * `resolvePasswordAttempt` for the full resolution order (registry
 * passphrase wrap -> recovery sidecar with same-machine self-heal -> legacy
 * raw-key fallback).
 */
export async function openDatabase(
  params: { path: string; password?: string },
  getDb: () => DatabaseService,
  getDbManager: () => DatabaseManager,
  callbacks: DatabaseLifecycleCallbacks,
  keyStore: DbKeyStoreWithRecoveryLike
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
      const resolution = resolvePasswordAttempt(vPath, vPassword, keyStore)
      if (resolution.kind === 'wrong-passphrase') {
        return { success: false, error: 'WRONG_PASSWORD' }
      }
      effectiveKey = resolution.dek
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

/**
 * Set (or replace) a recovery passphrase on the CURRENTLY OPEN database's
 * managed key. Non-destructive: envelope-wraps the SAME DEK via
 * `keyStore.setPassphrase` -- unlike `rekeyDatabase` (a `PRAGMA rekey` that
 * changes the live SQLCipher key), this never touches the database file or
 * its actual encryption key. Also writes the escrow recovery sidecar next to
 * the database (see `db-key-store.ts`'s `setPassphrase`).
 *
 * Gated to the currently open database's path via `getDbManager().getCurrentPath()`
 * -- there is no caller-supplied path parameter to spoof. A database that was
 * never registered in the key-store (an explicit-password database, or an
 * unencrypted one) has no `keyId` for its path, so it is rejected with a
 * typed error rather than silently doing nothing -- this doubles as the
 * "managed-key databases only" gate without a separate check.
 */
export function setRecoveryPassphrase(
  passphrase: string,
  getDbManager: () => DatabaseManager,
  keyStore: Pick<DbKeyStoreWithPassphraseLike, 'setPassphrase' | 'getKeyIdForPath'>
): SetRecoveryPassphraseResult {
  const manager = getDbManager()
  const currentPath = manager.getCurrentPath()
  if (currentPath === null) {
    throw new DatabaseError('No database is currently open.')
  }

  const keyId = keyStore.getKeyIdForPath(currentPath)
  if (keyId === null) {
    throw new DatabaseError(
      'The current database has no managed encryption key to set a recovery passphrase on. ' +
        'This action is only available for databases created with encryption-by-default.'
    )
  }

  const result = keyStore.setPassphrase(keyId, passphrase)
  if (!result.ok) {
    if (result.reason === 'cannot-resolve-dek') {
      throw new DatabaseError(
        'Could not unlock the managed encryption key on this machine right now, so a recovery ' +
          "passphrase could not be set. Check that this system's secure key storage " +
          '(keyring) is available and try again.'
      )
    }
    throw new DatabaseError('The managed encryption key for this database could not be found.')
  }

  if (!result.sidecarWritten) {
    mainLogger.warn(
      'Recovery passphrase was set on the managed key, but writing the portable recovery ' +
        'sidecar file failed -- the passphrase works on this machine but the database is not ' +
        'yet portable to another machine or a fresh key registry.',
      'database'
    )
  }

  return { success: true, recoveryPassphraseSet: true, sidecarWritten: result.sidecarWritten }
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
