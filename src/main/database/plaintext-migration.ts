/**
 * plaintext-migration.ts -- consented, backed-up, REVERSIBLE migration of an
 * existing PLAINTEXT SQLite database to encrypted-at-rest.
 *
 * See `.superpowers/sdd/task-I2b-brief.md` for the full design and safety
 * rationale. This module is intentionally low-level and self-contained: it
 * knows nothing about `DatabaseManager`/`DatabaseService` sessions or IPC --
 * the orchestration layer (`src/main/ipc/handlers/database-migration-logic.ts`)
 * closes/reopens the live app connection around a call to
 * `migratePlaintextToEncrypted`.
 *
 * The algorithm, IN ORDER -- the safety guarantees depend on this order:
 *
 *   1. PRECONDITION: `path` exists and is genuinely plaintext (opening it
 *      with NO key succeeds). An already-encrypted (or unreadable) DB is a
 *      typed no-op error -- nothing is written.
 *   2. CHECKPOINT the original's WAL (if any) so its main `.db` file is a
 *      complete, self-contained snapshot, and capture a content signal
 *      (row counts + a per-table content hash, per table, plus
 *      `user_version`). The WAL checkpoint (`PRAGMA journal_mode = DELETE`)
 *      return value is asserted -- a candidate/backup byte-copy of `path` is
 *      only correct without also copying `-wal`/`-shm` sidecars if this
 *      pragma actually took effect.
 *   3. Produce an ENCRYPTED CANDIDATE at a new temp file:
 *        - byte-copy `path` -> `<path>.encrypting-<nonce>.tmp`
 *        - `PRAGMA rekey` the COPY in place with the DEK.
 *      NOTE: this repo's SQLite backend (`better-sqlite3-multiple-ciphers`,
 *      which bundles `sqlite3mc` -- SQLite3 Multiple Ciphers -- rather than
 *      upstream SQLCipher) does NOT implement SQLCipher's `sqlcipher_export()`
 *      SQL function. This was verified directly: the string
 *      "sqlcipher_export" appears nowhere in the vendored amalgamated
 *      `sqlite3.c` nor in the compiled native addon's symbol table (checked
 *      via `strings` on the built `.node` binary). `PRAGMA rekey` against an
 *      in-place byte-copy is this repo's own proven encryption-conversion
 *      mechanism -- see `tests/main/database/sqlcipher.test.ts` ("should
 *      rekey from unencrypted to encrypted") -- and it gives the identical
 *      safety property the brief's ATTACH+sqlcipher_export recipe was after:
 *      the ORIGINAL file is never touched by this step, only a disposable
 *      copy is.
 *   4. VERIFY the candidate: open it WITH the DEK, require
 *      `PRAGMA integrity_check` = `'ok'` AND that its content signal matches
 *      the ORIGINAL's signal captured in step 2. Any failure here is a typed
 *      error; the candidate is deleted and the ORIGINAL is untouched.
 *   5. BACKUP the original: byte-copy `path` -> a timestamped
 *      `<path>.plaintext-backup-<ts>` file (plus `-wal`/`-shm` sidecars, if
 *      any still exist), then OPEN the backup with NO key, require
 *      `PRAGMA integrity_check` = `'ok'`, AND that its content signal
 *      matches the ORIGINAL's -- all BEFORE the swap in step 6. A partial or
 *      truncated backup copy is caught here, not discovered later during a
 *      rollback that depends on it.
 *   6. ATOMIC SWAP: fsync the candidate file, then `fs.renameSync(tmp,
 *      path)` -- same directory, atomic on POSIX/Windows -- then
 *      best-effort fsync the containing directory. CRASH RECOVERY: a
 *      `*.plaintext-backup-*` sibling sitting next to an ENCRYPTED `path`
 *      means a migration may not have durably completed (this step's
 *      fsyncs, or step 7, or the caller's post-migration reopen, never
 *      finished) -- that backup IS the recovery source: copy it back over
 *      `path` to restore the plaintext original.
 *   7. POST-SWAP VERIFY: re-open `path` WITH the DEK and re-run the same
 *      check as step 4. This is normally redundant with step 4 (rename does
 *      not alter bytes), but it is the one place a failure means `path`'s
 *      bytes have already changed -- so on failure here, restore the
 *      ORIGINAL from the step-5 backup so the user is never left without a
 *      working database.
 *
 * All failure paths funnel through `PlaintextMigrationError` and never log
 * the DEK or any passphrase.
 */

import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { existsSync, copyFileSync, renameSync, unlinkSync, statSync } from 'fs'
import { randomUUID } from 'crypto'
import { assertNotHexLiteralKey } from './sqlcipher-key-guard'
import { isNotADatabaseError } from './sqlite-error'
import type { DbKeyStoreLike } from './db-key-store'
import {
  computeContentSignal,
  signalsMatch,
  type ContentSignal
} from './plaintext-migration-signal'
import { fsyncContainingDirectory, fsyncFile } from './fs-durability'

export type { ContentSignal }

export type PlaintextMigrationFailureReason =
  'already-encrypted' | 'source-missing' | 'verification-failed' | 'swap-failed'

/** Typed error for every failure path of `migratePlaintextToEncrypted`. Never carries the DEK. */
export class PlaintextMigrationError extends Error {
  public readonly reason: PlaintextMigrationFailureReason

  constructor(message: string, reason: PlaintextMigrationFailureReason, cause?: Error) {
    super(message)
    this.name = 'PlaintextMigrationError'
    this.reason = reason
    if (cause !== undefined) {
      ;(this as Error & { cause?: Error }).cause = cause
    }
    Object.setPrototypeOf(this, PlaintextMigrationError.prototype)
  }
}

export interface MigratePlaintextToEncryptedParams {
  /** Path to the existing plaintext SQLite database. */
  path: string
  /** The SQLCipher DEK to encrypt with -- a hex string, never logged. */
  dek: string
  /** Key-store identity for `dek`, so a failed migration can roll back the registry entry. */
  keyId: string
  keyStore: Pick<DbKeyStoreLike, 'removeKey'>
}

export interface MigratePlaintextToEncryptedResult {
  /** Path to the plaintext backup kept alongside `path` after a successful migration. */
  backupPath: string
}

/**
 * Injectable seam so tests can fault-inject specifically the POST-swap
 * verification (step 7) without affecting the PRE-swap verification (step
 * 4), which must succeed for a test to exercise the swap at all. Defaults to
 * the real implementation in production.
 */
export interface PlaintextMigrationDeps {
  verifyEncrypted?: (filePath: string, dek: string) => ContentSignal
  /**
   * Test-only hook invoked immediately after the plaintext backup file (and
   * its sidecars) are written in step 5, before the backup is verified. Lets
   * tests simulate a truncated/corrupted backup copy against the REAL
   * verification logic below, without mocking the filesystem. No-op in
   * production.
   */
  afterBackupCopy?: (backupPath: string) => void
  /**
   * Test-only hook invoked immediately after the encrypting candidate (step
   * 3) is copied and rekeyed, before it is verified in step 4. Lets tests
   * construct a same-cardinality content divergence (same row count,
   * different values) against the REAL candidate file, so step 4's
   * strengthened content signal can be proven to catch it via the real
   * verification code path. No-op in production.
   */
  afterCandidateRekey?: (candidatePath: string, dek: string) => void
}

function quoteSqlLiteral(value: string): string {
  return value.split("'").join("''")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Real implementation of the injectable verify seam (step 4 and step 7).
 * Exported (in addition to being the default) so tests can let ONE of the
 * two `deps.verifyEncrypted` calls in a fault-injection test run for real,
 * without duplicating the content-signal algorithm in test code.
 */
export function realVerifyEncrypted(filePath: string, dek: string): ContentSignal {
  const db = new Database(filePath)
  try {
    // CRITICAL: the key pragma must be the first pragma issued (matches
    // `DatabaseService`'s constructor ordering).
    db.pragma(`key='${quoteSqlLiteral(dek)}'`)
    const integrity = db.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') {
      throw new PlaintextMigrationError(
        `Encrypted database failed integrity_check (${integrity})`,
        'verification-failed'
      )
    }
    return computeContentSignal(db)
  } finally {
    db.close()
  }
}

/**
 * Assert that `PRAGMA journal_mode = DELETE` actually landed in `'delete'`
 * mode, rather than trusting the pragma silently. SQLite always returns the
 * RESULTING journal mode from this statement (whether or not the requested
 * change took effect -- e.g. it cannot leave WAL mode while another
 * connection still has the database open), so a truthful check is just
 * comparing the returned value.
 */
function checkpointOutOfWalMode(db: DatabaseType, context: string): void {
  const journalMode = db.pragma('journal_mode = DELETE', { simple: true }) as string
  if (journalMode !== 'delete') {
    throw new PlaintextMigrationError(
      `Failed to checkpoint ${context} out of WAL mode (journal_mode is '${journalMode}', ` +
        `expected 'delete') -- refusing to proceed with a possibly-incomplete snapshot`,
      'verification-failed'
    )
  }
}

/**
 * Precondition check (step 1) + WAL checkpoint (step 2, first half) + content
 * signal capture (step 2, second half), all against one connection.
 */
function assertPlaintextAndCaptureSignal(path: string): ContentSignal {
  if (!existsSync(path)) {
    throw new PlaintextMigrationError(`No database file exists at ${path}`, 'source-missing')
  }

  const db = new Database(path)
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch (error) {
    db.close()
    if (isNotADatabaseError(error)) {
      throw new PlaintextMigrationError(
        `Database at ${path} is already encrypted (or unreadable)`,
        'already-encrypted'
      )
    }
    throw error
  }

  try {
    // Fold any pending WAL frames into the main file and drop WAL mode so a
    // plain byte-copy of `path` afterward (both for the encrypting candidate
    // and, later, for the plaintext backup) is a complete, self-contained
    // snapshot -- no separate `-wal`/`-shm` sidecar needs to travel with it.
    // The candidate's and backup's completeness DEPEND on this pragma
    // actually taking effect, so its return value is asserted, not trusted.
    checkpointOutOfWalMode(db, 'the source database')
    const signal = computeContentSignal(db)
    return signal
  } finally {
    db.close()
  }
}

/** Open a PLAINTEXT file with NO key, verify integrity, and return its content signal. */
function realVerifyPlaintextBackup(filePath: string): ContentSignal {
  const db = new Database(filePath)
  try {
    const integrity = db.pragma('integrity_check', { simple: true }) as string
    if (integrity !== 'ok') {
      throw new PlaintextMigrationError(
        `Plaintext backup failed integrity_check (${integrity})`,
        'verification-failed'
      )
    }
    return computeContentSignal(db)
  } finally {
    db.close()
  }
}

function cleanupFile(path: string): void {
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {
      // Best-effort cleanup; the caller is already inside a failure path and
      // must not throw a second, more confusing error over the first.
    }
  }
}

function copySidecarsIfPresent(fromPath: string, toPath: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const from = `${fromPath}${suffix}`
    if (existsSync(from)) {
      copyFileSync(from, `${toPath}${suffix}`)
    }
  }
}

/**
 * Fsync a regular file so its bytes are durably on disk before the atomic
 * rename that makes it `path` -- a failure here is treated as a real,
 * proceed-blocking error (see the step-6 call site), not best-effort.
 */
/**
 * Migrate a plaintext SQLite database at `path` to encrypted-at-rest with
 * `dek`, following the algorithm documented at the top of this file. Throws
 * `PlaintextMigrationError` on any failure; on success returns the backup
 * path so the caller can offer to delete it once the user confirms the
 * encrypted database opens.
 */
export function migratePlaintextToEncrypted(
  params: MigratePlaintextToEncryptedParams,
  deps: PlaintextMigrationDeps = {}
): MigratePlaintextToEncryptedResult {
  const { path, dek, keyId, keyStore } = params
  const verifyEncrypted = deps.verifyEncrypted ?? realVerifyEncrypted
  const afterBackupCopy = deps.afterBackupCopy ?? (() => undefined)
  const afterCandidateRekey = deps.afterCandidateRekey ?? (() => undefined)

  assertNotHexLiteralKey(dek)

  // Steps 1-2: precondition + checkpoint + capture the original's signal.
  // No stale key-store entry may survive ANY failure path -- including this
  // earliest one (source missing / already encrypted / WAL checkpoint
  // didn't take) -- so this is rolled back exactly like the later steps.
  let originalSignal: ContentSignal
  try {
    originalSignal = assertPlaintextAndCaptureSignal(path)
  } catch (error) {
    keyStore.removeKey(keyId)
    throw error
  }

  const tmpPath = `${path}.encrypting-${randomUUID()}.tmp`

  const rollbackBeforeSwap = (cause: unknown): never => {
    cleanupFile(tmpPath)
    keyStore.removeKey(keyId)
    if (cause instanceof PlaintextMigrationError) {
      throw cause
    }
    throw new PlaintextMigrationError(
      `Failed to prepare an encrypted copy of the database: ${errorMessage(cause)}`,
      'verification-failed',
      cause instanceof Error ? cause : undefined
    )
  }

  // Step 3: produce the encrypted candidate.
  try {
    copyFileSync(path, tmpPath)
    const tmpDb = new Database(tmpPath)
    try {
      checkpointOutOfWalMode(tmpDb, 'the encrypting candidate') // rekey requires a non-WAL journal mode
      tmpDb.pragma(`rekey='${quoteSqlLiteral(dek)}'`)
    } finally {
      tmpDb.close()
    }
    afterCandidateRekey(tmpPath, dek)
  } catch (error) {
    return rollbackBeforeSwap(error)
  }

  // Step 4: verify the candidate before touching the original at all.
  let candidateSignal: ContentSignal
  try {
    candidateSignal = verifyEncrypted(tmpPath, dek)
  } catch (error) {
    return rollbackBeforeSwap(error)
  }

  if (!signalsMatch(originalSignal, candidateSignal)) {
    return rollbackBeforeSwap(
      new PlaintextMigrationError(
        'Encrypted database content does not match the original -- refusing to proceed',
        'verification-failed'
      )
    )
  }

  // Step 5: back up the original, then VERIFY the backup is genuinely
  // openable and complete -- BEFORE the swap depends on it. A silent
  // partial/truncated copy accepted here would later be relied on by
  // `rollbackAfterSwap` -- restoring from a corrupt backup is permanent data
  // loss, so this must fail loudly, before the swap, not during a rollback.
  const backupPath = `${path}.plaintext-backup-${Date.now()}`
  try {
    copyFileSync(path, backupPath)
    copySidecarsIfPresent(path, backupPath)
    fsyncFile(backupPath)
    fsyncContainingDirectory(backupPath)
    afterBackupCopy(backupPath)
    const stat = statSync(backupPath)
    if (stat.size === 0) {
      throw new Error('Backup file was created but is empty')
    }
    const backupSignal = realVerifyPlaintextBackup(backupPath)
    if (!signalsMatch(originalSignal, backupSignal)) {
      throw new PlaintextMigrationError(
        'Plaintext backup content does not match the original -- refusing to proceed',
        'verification-failed'
      )
    }
  } catch (error) {
    cleanupFile(backupPath)
    return rollbackBeforeSwap(error)
  }

  // Step 6: atomic swap.
  //
  // fsync the candidate's bytes to disk before the rename gates on them, and
  // best-effort fsync the containing directory after the rename lands, to
  // narrow the window in which a crash could leave a rename that "happened"
  // in the page cache but never reached disk. CRASH RECOVERY: a
  // `*.plaintext-backup-*` sibling sitting next to an ENCRYPTED `path` means
  // a migration may not have durably completed (this step, step 7, or the
  // caller's post-migration reopen never finished) -- that backup IS the
  // recovery source; copy it back over `path` to restore the plaintext
  // original.
  try {
    fsyncFile(tmpPath)
  } catch (error) {
    return rollbackBeforeSwap(error)
  }

  try {
    renameSync(tmpPath, path)
  } catch (error) {
    return rollbackAfterSwap(path, backupPath, tmpPath, keyId, keyStore, error)
  }
  fsyncContainingDirectory(path)

  // Step 7: post-swap verification. On failure, `path` has already changed
  // -- restore from the backup so the user is never left without a working DB.
  try {
    verifyEncrypted(path, dek)
  } catch (error) {
    return rollbackAfterSwap(path, backupPath, tmpPath, keyId, keyStore, error)
  }

  return { backupPath }
}

function rollbackAfterSwap(
  path: string,
  backupPath: string,
  tmpPath: string,
  keyId: string,
  keyStore: Pick<DbKeyStoreLike, 'removeKey'>,
  cause: unknown
): never {
  cleanupFile(tmpPath)

  try {
    copyFileSync(backupPath, path)
    copySidecarsIfPresent(backupPath, path)
    fsyncFile(path)
    fsyncContainingDirectory(path)
  } catch (restoreError) {
    keyStore.removeKey(keyId)
    throw new PlaintextMigrationError(
      `Migration failed after the encrypted swap, AND restoring the original from backup ` +
        `also failed. The plaintext backup is still intact at ${backupPath} -- restore it ` +
        `manually. Swap failure: ${errorMessage(cause)}; restore failure: ${errorMessage(restoreError)}`,
      'swap-failed',
      restoreError instanceof Error ? restoreError : undefined
    )
  }

  keyStore.removeKey(keyId)
  throw new PlaintextMigrationError(
    `Migration failed after the encrypted swap; the original plaintext database was restored ` +
      `from backup and is unchanged: ${errorMessage(cause)}`,
    'swap-failed',
    cause instanceof Error ? cause : undefined
  )
}
