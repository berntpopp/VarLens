/**
 * Orchestration for the consented, backed-up, REVERSIBLE plaintext -> encrypted
 * migration IPC actions (`database:migrateToEncrypted`,
 * `database:deletePlaintextBackup`). See `.superpowers/sdd/task-I2b-brief.md`
 * for the full design; the actual byte-level migration algorithm lives in
 * `src/main/database/plaintext-migration.ts` -- this module only wires it to
 * the app's live `DatabaseManager` session and the key-store.
 *
 * Split out of `database-lifecycle-logic.ts` (rather than added to it) to
 * keep both files well under the repo's LLM-sustainable size guideline; kept
 * as a peer module rather than re-exported through `database-logic.ts`'s
 * barrel to avoid growing that file further -- the IPC handler imports both
 * directly.
 */
import { resolve } from 'path'
import { existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { mainLogger } from '../../services/MainLogger'
import { DatabaseError } from '../../database/errors'
import {
  migratePlaintextToEncrypted,
  PlaintextMigrationError
} from '../../database/plaintext-migration'
import type { DatabaseManager } from '../../services/DatabaseManager'
import type { DbKeyStoreWithPassphraseLike } from '../../database/db-key-store'
import type {
  DatabaseActionResult,
  MigrateToEncryptedOptions,
  MigrateToEncryptedResult
} from '../../../shared/ipc/domains/database'
import type { DatabaseLifecycleCallbacks } from './database-lifecycle-logic'
import { removeRecoverySidecar } from '../../database/recovery-sidecar'
import { fsyncContainingDirectory } from '../../database/fs-durability'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Orchestrate the full migration flow:
 *  (a) require the DB be currently open + plaintext SQLite
 *  (b) obtain a DEK -- a managed (safeStorage) key if available, else REQUIRE
 *      a recovery passphrase (never silently skip encryption)
 *  (c) close the live connection
 *  (d) run `migratePlaintextToEncrypted`
 *  (e) reopen the now-encrypted DB
 *  (f) return the backup path + whether a recovery passphrase is set
 *
 * Never migrates without `options.consent === true`. On any failure, the app
 * is left with a working (re-opened) database -- see the two `catch` blocks
 * below and `plaintext-migration.ts`'s own rollback guarantees.
 */
export async function migrateCurrentToEncrypted(
  options: MigrateToEncryptedOptions,
  getDbManager: () => DatabaseManager,
  keyStore: DbKeyStoreWithPassphraseLike,
  callbacks: DatabaseLifecycleCallbacks
): Promise<MigrateToEncryptedResult> {
  if (options.consent !== true) {
    throw new DatabaseError('Migrating to an encrypted database requires explicit consent.')
  }

  const manager = getDbManager()
  const currentInfo = manager.getCurrentInfo()
  const currentPath = manager.getCurrentPath()

  if (currentInfo === null || currentPath === null || currentInfo.encrypted) {
    throw new DatabaseError(
      'Migration requires a currently open, plaintext SQLite database. Open one first.'
    )
  }

  const recoveryPassphrase =
    options.recoveryPassphrase !== undefined && options.recoveryPassphrase !== ''
      ? options.recoveryPassphrase
      : undefined

  // Migration keys are persisted as pending. In-process failures remove
  // them; a hard crash is reconciled on the next verified open: plaintext
  // removes the abandoned entry, encrypted activates it.
  const managed = keyStore.createPendingManagedKey(currentPath)
  let dek: string
  let keyId: string
  let recoveryPassphraseSet = false
  let passphraseOnly = false
  let sidecarWritten: boolean | undefined

  if (managed.ok) {
    dek = managed.dek
    keyId = managed.keyId
  } else if (managed.reason === 'path-already-keyed') {
    throw new DatabaseError(
      'This database path already has a registered encryption key -- it may already be ' +
        'migrated. Reopen the database to check.'
    )
  } else if (recoveryPassphrase !== undefined) {
    // safeStorage unavailable: fall back to a passphrase-only wrap. This is
    // the ONLY case where a passphrase is required rather than optional.
    const wrapped = keyStore.wrapNewPendingDekWithPassphrase(currentPath, recoveryPassphrase)
    if (!wrapped.ok) {
      throw new DatabaseError(
        'This database path already has a registered encryption key -- it may already be ' +
          'migrated. Reopen the database to check.'
      )
    }
    dek = wrapped.dek
    keyId = wrapped.keyId
    if (!wrapped.sidecarWritten) {
      keyStore.removeKey(keyId)
      throw new DatabaseError(
        'The required recovery sidecar could not be written. The database was not migrated; ' +
          'check the database directory permissions and try again.'
      )
    }
    recoveryPassphraseSet = true
    sidecarWritten = true
    passphraseOnly = true
  } else {
    // No keyring AND no passphrase: refuse outright. Never half-migrate.
    throw new DatabaseError(
      'No secure key storage is available on this system, and no recovery passphrase was ' +
        'supplied. Provide a recovery passphrase to encrypt this database.'
    )
  }

  try {
    await manager.close()
  } catch (error) {
    // We minted a key-store entry above but never touched the database file
    // -- roll the entry back so a retry at the same path isn't burned.
    keyStore.removeKey(keyId)
    if (passphraseOnly) removeRecoverySidecarBestEffort(currentPath)
    throw error
  }

  let migrationCompleted = false
  try {
    const migration = migratePlaintextToEncrypted({ path: currentPath, dek, keyId, keyStore })
    migrationCompleted = true

    if (managed.ok && recoveryPassphrase !== undefined) {
      const setResult = keyStore.setPassphrase(keyId, recoveryPassphrase)
      recoveryPassphraseSet = setResult.ok
      sidecarWritten = setResult.ok ? setResult.sidecarWritten : false
      if (!setResult.ok) {
        mainLogger.warn(
          'Migration succeeded but setting the recovery passphrase failed; the managed key ' +
            'remains keyring-only.',
          'plaintext-migration'
        )
      }
    }

    await manager.open(currentPath, dek)
    keyStore.activateKey(keyId)
    try {
      callbacks.triggerStartupRebuild(manager.getCurrent())
    } catch (e) {
      mainLogger.warn(
        `triggerStartupRebuildIfNeeded failed after migration (best effort): ${errorMessage(e)}`,
        'plaintext-migration'
      )
    }

    const info = manager.getCurrentInfo()
    if (info === null) {
      throw new DatabaseError('Migration succeeded but the database session could not be reopened.')
    }

    return {
      success: true,
      backupPath: migration.backupPath,
      recoveryPassphraseSet,
      sidecarWritten,
      info: { ...info, keyManaged: true }
    }
  } catch (error) {
    // `migratePlaintextToEncrypted` already restored/left `currentPath` as a
    // working plaintext database on every one of its own failure paths (see
    // its module docs). Reopen it here so the app is NEVER left without a
    // working database, regardless of which step failed.
    if (migrationCompleted) {
      throw new DatabaseError(
        'The encrypted migration completed and was verified, but VarLens could not reopen the ' +
          'new session. The encryption key remains recoverable; restart VarLens and reopen the ' +
          'database. Keep the plaintext backup until the encrypted database opens successfully.',
        error instanceof Error ? error : undefined
      )
    }

    try {
      await manager.open(currentPath)
    } catch (reopenError) {
      mainLogger.error(
        `Failed to reopen the original database after a failed migration: ${errorMessage(reopenError)}`,
        'plaintext-migration'
      )
    }

    if (passphraseOnly && !migrationCompleted) {
      removeRecoverySidecarBestEffort(currentPath)
    }

    if (error instanceof PlaintextMigrationError || error instanceof DatabaseError) {
      throw error
    }
    throw new DatabaseError(
      `Failed to migrate database to encrypted-at-rest: ${errorMessage(error)}`,
      error instanceof Error ? error : undefined
    )
  }
}

function removeRecoverySidecarBestEffort(dbPath: string): void {
  try {
    removeRecoverySidecar(dbPath)
  } catch (error) {
    mainLogger.warn(
      `Failed to remove a recovery sidecar while rolling back migration: ${errorMessage(error)}`,
      'plaintext-migration'
    )
  }
}

/**
 * Authority check tying a backup-delete request to the CURRENTLY open
 * database path: only `<currentPath>.plaintext-backup-<digits>` (the exact
 * naming pattern `migratePlaintextToEncrypted` produces) is deletable --
 * never an arbitrary caller-supplied path.
 */
function isPlaintextBackupOfPath(backupPath: string, currentPath: string): boolean {
  const resolvedBackup = resolve(backupPath)
  const resolvedCurrent = resolve(currentPath)
  const prefix = `${resolvedCurrent}.plaintext-backup-`
  if (!resolvedBackup.startsWith(prefix)) {
    return false
  }
  const suffix = resolvedBackup.slice(prefix.length)
  return /^\d+$/.test(suffix)
}

/**
 * Delete a plaintext backup produced by a prior migration, plus any
 * `-wal`/`-shm` sidecars. Refuses any path that isn't exactly the backup of
 * the currently-open database.
 */
export async function deletePlaintextBackup(
  backupPath: string,
  getDbManager: () => DatabaseManager
): Promise<DatabaseActionResult> {
  const manager = getDbManager()
  const currentPath = manager.getCurrentPath()

  if (currentPath === null) {
    throw new DatabaseError('No database is currently open.')
  }

  if (!isPlaintextBackupOfPath(backupPath, currentPath)) {
    throw new DatabaseError(
      'Refusing to delete a file that is not a plaintext backup of the currently open database.'
    )
  }

  const resolvedBackup = resolve(backupPath)
  if (!existsSync(resolvedBackup)) {
    return { success: true }
  }

  // Remove plaintext-bearing sidecars first. If one fails, keep the main
  // backup and fail the action rather than claiming all plaintext is gone.
  for (const suffix of ['-wal', '-shm']) {
    const sidecarPath = `${resolvedBackup}${suffix}`
    if (existsSync(sidecarPath)) {
      await unlink(sidecarPath)
    }
  }
  await unlink(resolvedBackup)
  fsyncContainingDirectory(resolvedBackup)

  mainLogger.info(`Deleted plaintext backup: ${resolvedBackup}`, 'database')
  return { success: true }
}
