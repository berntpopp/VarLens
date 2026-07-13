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
  DbKeyStore,
  DbKeyStoreLike,
  DbKeyStoreWithPassphraseLike,
  DbKeyStoreWithRecoveryLike,
  PassphraseWrap
} from '../../database/db-key-store'
import { existsSync } from 'fs'
import {
  readRecoverySidecar,
  recoverySidecarExists,
  removeRecoverySidecar
} from '../../database/recovery-sidecar'
import type {
  DatabaseInfo,
  DatabaseOpenResult,
  SetRecoveryPassphraseResult
} from '../../../shared/ipc/domains/database'
import type { StorageCapabilities } from '../../../shared/types/storage-capabilities'
import type { PostgresHealthDiagnosticResult } from '../../../shared/types/postgres-profile'

type DbKeyStoreProvisioningLike = DbKeyStoreLike &
  Partial<
    Pick<
      DbKeyStore,
      | 'createPendingManagedKey'
      | 'wrapNewPendingDekWithPassphrase'
      | 'getKeyStateForPath'
      | 'getKeyIdForPath'
      | 'activateKey'
    >
  >

/** Callbacks for pool init and cohort rebuild during database open/create. */
export interface DatabaseLifecycleCallbacks {
  triggerStartupRebuild: (db: DatabaseService) => void
}

/**
 * Attach `keyManaged` to a `DatabaseInfo` snapshot by checking whether its
 * `path` has a key-store registry entry. `null` passes through unchanged. A
 * non-SQLite (PostgreSQL) session's `path` is never registered in the
 * SQLite key-store, so this naturally resolves to `keyManaged: false` for it
 * without needing a separate backend check.
 */
function attachKeyManaged(
  info: DatabaseInfo | null,
  keyStore: Pick<DbKeyStoreWithRecoveryLike, 'getKeyIdForPath'>
): DatabaseInfo | null {
  if (info === null) return null
  return { ...info, keyManaged: keyStore.getKeyIdForPath(info.path) !== null }
}

/**
 * Attach a statically-known `keyManaged` value to a `DatabaseInfo` snapshot.
 * Used by `createDatabase`, whose three branches already know for certain
 * whether a key-store entry was (or wasn't) minted for the path just
 * created, so no registry lookup is needed.
 */
function withKeyManaged(info: DatabaseInfo | null, keyManaged: boolean): DatabaseInfo | null {
  if (info === null) return null
  return { ...info, keyManaged }
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
 * After a successful sidecar-based passphrase recovery, make future opens at
 * `vPath` transparent on THIS machine: repoint an existing LOCAL entry for
 * the SAME DEK (the "same-machine move" case -- the `.db` file, plus its
 * sidecar, moved to a new path on a machine that already has a keyring entry
 * for that exact DEK under the old, now-stale path) rather than minting a
 * redundant key. Otherwise enroll a brand-new entry from the sidecar's wrap
 * so a genuinely new/wiped machine also becomes transparent next time. A
 * stale mapping already occupying the restored path is displaced only after
 * SQLite verification; its wrapped key remains preserved as an orphan.
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

  keyStore.enrollRecoveredKey(vPath, dek, passWrap)
}

/**
 * Resolve a supplied password/passphrase attempt against, in order: the
 * key-store's own passphrase wrap for this exact path (unchanged today's
 * behavior), then a portable recovery sidecar next to the database file
 * (returning a pending self-heal that `openDatabase` applies only after
 * SQLite accepts the DEK), then the legacy fallback of treating the supplied
 * value as a raw SQLCipher key.
 *
 * Unwrapped values are candidates, not trusted answers. SQLite verifies each
 * candidate in order because a stale registry wrap can authenticate the same
 * reused passphrase while belonging to a different database that previously
 * occupied this path. Registry repointing/enrollment remains deferred until
 * one candidate actually opens the target database.
 */
interface ResolvedPasswordCandidate {
  effectiveKey?: string
  pendingSidecarRecovery?: { dek: string; passWrap: PassphraseWrap }
}

function resolvePasswordCandidates(
  vPath: string,
  vPassword: string,
  keyStore: DbKeyStoreWithRecoveryLike
): ResolvedPasswordCandidate[] {
  const candidates: ResolvedPasswordCandidate[] = []
  const addCandidate = (candidate: ResolvedPasswordCandidate): void => {
    if (!candidates.some((existing) => existing.effectiveKey === candidate.effectiveKey)) {
      candidates.push(candidate)
    }
  }

  const viaRegistry = keyStore.resolveKeyWithPassphrase(vPath, vPassword)
  if (viaRegistry.ok) {
    addCandidate({ effectiveKey: viaRegistry.dek })
  }

  if (recoverySidecarExists(vPath)) {
    const sidecar = readRecoverySidecar(vPath)
    if (sidecar !== null) {
      const viaSidecar = keyStore.resolveKeyWithPassphraseFromSidecar(sidecar.passWrap, vPassword)
      if (viaSidecar.ok) {
        addCandidate({
          effectiveKey: viaSidecar.dek,
          pendingSidecarRecovery: { dek: viaSidecar.dek, passWrap: sidecar.passWrap }
        })
      }
    }
  }

  // Always retain the legacy raw-key attempt as the final candidate. A stale
  // registry or sidecar wrap may authenticate the same user passphrase while
  // describing a different database that previously occupied this path; only
  // SQLite can authoritatively choose among the successfully unwrapped keys.
  addCandidate({ effectiveKey: vPassword })
  return candidates
}

async function switchDatabaseWithVerifiedCandidate(
  manager: DatabaseManager,
  vPath: string,
  candidates: ResolvedPasswordCandidate[]
): Promise<ResolvedPasswordCandidate> {
  for (const candidate of candidates) {
    try {
      await manager.switchDatabase(vPath, candidate.effectiveKey)
      return candidate
    } catch (error) {
      if (!(error instanceof WrongPasswordError)) throw error
    }
  }
  throw new WrongPasswordError()
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
 * `resolvePasswordCandidates` for the full verified order (registry
 * passphrase wrap -> recovery sidecar with deferred same-machine self-heal ->
 * legacy raw-key fallback).
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
  const pendingKeyId =
    keyStore.getKeyStateForPath(vPath) === 'pending' ? keyStore.getKeyIdForPath(vPath) : null

  let candidates: ResolvedPasswordCandidate[]

  if (needsPassword) {
    if (vPassword === undefined || vPassword === '') {
      const resolved = keyStore.resolveKeyForPath(vPath)
      if (!resolved.ok) {
        return { success: false, needsPassword: true }
      }
      candidates = [{ effectiveKey: resolved.dek }]
    } else {
      candidates = resolvePasswordCandidates(vPath, vPassword, keyStore)
    }
  } else {
    candidates = [{ effectiveKey: vPassword }]
  }

  // Switch to new database with rollback on failure
  try {
    const verifiedCandidate = await switchDatabaseWithVerifiedCandidate(manager, vPath, candidates)
    const pendingSidecarRecovery = verifiedCandidate.pendingSidecarRecovery
    mainLogger.info(`Switched to database: ${vPath}`, 'database')

    if (pendingKeyId !== null) {
      if (needsPassword) {
        keyStore.activateKey(pendingKeyId)
      } else {
        // Plaintext detection plus a successful open proves the pending
        // migration never swapped. Remove only now, after verification.
        keyStore.removeKey(pendingKeyId)
        removeRecoverySidecarBestEffort(vPath)
      }
    }

    if (pendingSidecarRecovery !== undefined) {
      enrollOrRepointSidecarRecovery(
        vPath,
        pendingSidecarRecovery.dek,
        pendingSidecarRecovery.passWrap,
        keyStore
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

    const info = attachKeyManaged(manager.getCurrentInfo(), keyStore)
    return { success: true, info: info! }
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      if (needsPassword && (vPassword === undefined || vPassword === '')) {
        // A transparent registry key can be stale when a different encrypted
        // database was restored over the same path. Surface the normal
        // passphrase prompt so the verified sidecar/raw candidate flow above
        // remains reachable instead of stranding a valid recovery sidecar.
        return { success: false, needsPassword: true }
      }
      return { success: false, error: 'WRONG_PASSWORD' }
    }
    throw error
  }
}

/** Generic "don't silently create an unencrypted DB" failure for a key-store conflict. */
const PATH_ALREADY_KEYED_ERROR =
  'This database path already has a registered encryption key. Choose a different location.'
const RECOVERY_SIDECAR_REQUIRED_ERROR =
  'The portable recovery file could not be written. No database was created; check the destination permissions and try again.'

function removeRecoverySidecarBestEffort(dbPath: string): void {
  try {
    removeRecoverySidecar(dbPath)
  } catch (error) {
    mainLogger.warn(
      `Failed to remove a recovery sidecar while rolling back database creation: ${error instanceof Error ? error.message : String(error)}`,
      'database'
    )
  }
}

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
  keyStore: DbKeyStoreProvisioningLike
): Promise<DatabaseOpenResult> {
  const manager = getDbManager()

  if (params.password !== undefined && params.password !== '') {
    await manager.createDatabase(params.path, params.password)
    const info = withKeyManaged(manager.getCurrentInfo(), false)
    return { success: true, info: info! }
  }

  if (params.setupPassphrase !== undefined && params.setupPassphrase !== '') {
    reconcileMissingPendingProvision(params.path, keyStore)
    const wrapped =
      keyStore.wrapNewPendingDekWithPassphrase?.(params.path, params.setupPassphrase) ??
      keyStore.wrapNewDekWithPassphrase(params.path, params.setupPassphrase)
    if (!wrapped.ok) {
      return { success: false, error: PATH_ALREADY_KEYED_ERROR }
    }
    if (!wrapped.sidecarWritten) {
      keyStore.removeKey(wrapped.keyId)
      return { success: false, error: RECOVERY_SIDECAR_REQUIRED_ERROR }
    }
    try {
      await manager.createDatabase(params.path, wrapped.dek)
      keyStore.activateKey?.(wrapped.keyId)
    } catch (error) {
      // The registry entry was written before the DB file exists. If creation
      // fails (disk full, permission error, path collision), roll it back so
      // the path isn't permanently burned -- a retry must be able to mint a
      // fresh key for the same path instead of hitting `path-already-keyed`.
      keyStore.removeKey(wrapped.keyId)
      removeRecoverySidecarBestEffort(params.path)
      throw error
    }
    const info = withKeyManaged(manager.getCurrentInfo(), true)
    return { success: true, info: info! }
  }

  reconcileMissingPendingProvision(params.path, keyStore)
  const managed =
    keyStore.createPendingManagedKey?.(params.path) ?? keyStore.createManagedKey(params.path)
  if (managed.ok) {
    try {
      await manager.createDatabase(params.path, managed.dek)
      keyStore.activateKey?.(managed.keyId)
    } catch (error) {
      // Same rollback as the passphrase path above: don't leave a stale
      // key-store entry when the DB file was never actually created.
      keyStore.removeKey(managed.keyId)
      throw error
    }
    const info = withKeyManaged(manager.getCurrentInfo(), true)
    return { success: true, info: info! }
  }

  if (managed.reason === 'safe-storage-unavailable') {
    return { success: false, needsPassphraseSetup: true }
  }

  // path-already-keyed: never silently fall back to an unencrypted DB.
  return { success: false, error: PATH_ALREADY_KEYED_ERROR }
}

function reconcileMissingPendingProvision(
  dbPath: string,
  keyStore: DbKeyStoreProvisioningLike
): void {
  if (existsSync(dbPath) || keyStore.getKeyStateForPath?.(dbPath) !== 'pending') return
  const keyId = keyStore.getKeyIdForPath?.(dbPath)
  if (keyId === undefined || keyId === null) return
  keyStore.removeKey(keyId)
  removeRecoverySidecarBestEffort(dbPath)
}

/**
 * Change the encryption key for the current database via `PRAGMA rekey`.
 *
 * REFUSED for a key-store-managed database (one with a registry entry for
 * its current path -- i.e. created encrypted-by-default, or migrated to
 * encrypted). A `PRAGMA rekey` changes the LIVE SQLCipher key directly,
 * without touching the key-store's wrapped DEK/registry entry/recovery
 * sidecar/live session key -- the next open would then resolve the STALE
 * DEK and fail with `WRONG_PASSWORD`, and a mismatched recovery sidecar left
 * behind by the stale DEK could otherwise make even the correct raw
 * password unusable. Managed databases must use `setRecoveryPassphrase`
 * instead, which re-wraps the SAME DEK and never touches the live key.
 *
 * Legacy `rekey` stays valid ONLY for explicit-user-password databases that
 * have no key-store entry for their current path.
 */
export function rekeyDatabase(
  newPassword: string,
  getDbManager: () => DatabaseManager,
  keyStore: Pick<DbKeyStoreWithPassphraseLike, 'getKeyIdForPath'>
): { success: boolean } {
  const manager = getDbManager()
  const currentPath = manager.getCurrentPath()

  if (currentPath !== null && keyStore.getKeyIdForPath(currentPath) !== null) {
    throw new DatabaseError(
      'This database uses a managed encryption key and cannot have its password changed this ' +
        'way -- doing so would desynchronize it from the encryption key registry and could make ' +
        'the database unopenable. Use "Set Recovery Passphrase..." instead to add or replace a ' +
        'portable recovery passphrase without changing the underlying encryption key.'
    )
  }

  manager.rekey(newPassword)
  return { success: true }
}

/**
 * Set (or replace) a recovery passphrase on the CURRENTLY OPEN database's
 * managed key. Non-destructive: envelope-wraps the SAME DEK via
 * `keyStore.setPassphraseForVerifiedDek` -- unlike `rekeyDatabase` (a `PRAGMA rekey` that
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
  keyStore: Pick<DbKeyStoreWithPassphraseLike, 'setPassphraseForVerifiedDek' | 'getKeyIdForPath'>
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

  const verifiedDek = manager.getCurrent().getEncryptionKey()
  if (verifiedDek === undefined || verifiedDek === '') {
    throw new DatabaseError(
      'The current database session does not have a verified managed encryption key.'
    )
  }

  const result = keyStore.setPassphraseForVerifiedDek(keyId, verifiedDek, passphrase)
  if (!result.ok) {
    if (result.reason === 'cannot-resolve-dek') {
      throw new DatabaseError(
        'The verified encryption key from the current database session was not valid, so a ' +
          'recovery passphrase could not be set.'
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

export function getDatabaseInfo(
  getDbManager: () => DatabaseManager,
  keyStore: Pick<DbKeyStoreWithRecoveryLike, 'getKeyIdForPath'>
): DatabaseInfo | null {
  const manager = getDbManager()
  return attachKeyManaged(manager.getCurrentInfo(), keyStore)
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
