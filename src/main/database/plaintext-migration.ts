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
 *      (row counts per table + `user_version`). This makes every later
 *      byte-copy of `path` correct without also copying `-wal`/`-shm`
 *      sidecars.
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
 *      any still exist). Verified to exist with a non-zero size -- this
 *      backup MUST exist before the swap in step 6.
 *   6. ATOMIC SWAP: `fs.renameSync(tmp, path)` -- same directory, atomic on
 *      POSIX/Windows.
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

interface ContentSignal {
  userVersion: number
  tableRowCounts: Record<string, number>
}

/**
 * Injectable seam so tests can fault-inject specifically the POST-swap
 * verification (step 7) without affecting the PRE-swap verification (step
 * 4), which must succeed for a test to exercise the swap at all. Defaults to
 * the real implementation in production.
 */
export interface PlaintextMigrationDeps {
  verifyEncrypted?: (filePath: string, dek: string) => ContentSignal
}

function quoteSqlLiteral(value: string): string {
  return value.split("'").join("''")
}

function quoteIdentifier(name: string): string {
  return name.replace(/"/g, '""')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function computeContentSignal(db: DatabaseType): ContentSignal {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>

  const tableRowCounts: Record<string, number> = {}
  for (const { name } of tables) {
    const row = db.prepare(`SELECT COUNT(*) as c FROM "${quoteIdentifier(name)}"`).get() as {
      c: number
    }
    tableRowCounts[name] = row.c
  }

  const userVersion = db.pragma('user_version', { simple: true }) as number
  return { userVersion, tableRowCounts }
}

function signalsMatch(a: ContentSignal, b: ContentSignal): boolean {
  if (a.userVersion !== b.userVersion) {
    return false
  }
  const aKeys = Object.keys(a.tableRowCounts)
  const bKeys = Object.keys(b.tableRowCounts)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every((key) => a.tableRowCounts[key] === b.tableRowCounts[key])
}

/** Real implementation of the injectable verify seam (step 4 and step 7). */
function realVerifyEncrypted(filePath: string, dek: string): ContentSignal {
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

  // Fold any pending WAL frames into the main file and drop WAL mode so a
  // plain byte-copy of `path` afterward (both for the encrypting candidate
  // and, later, for the plaintext backup) is a complete, self-contained
  // snapshot -- no separate `-wal`/`-shm` sidecar needs to travel with it.
  db.pragma('journal_mode = DELETE')
  const signal = computeContentSignal(db)
  db.close()
  return signal
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

  assertNotHexLiteralKey(dek)

  // Steps 1-2: precondition + checkpoint + capture the original's signal.
  const originalSignal = assertPlaintextAndCaptureSignal(path)

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
      tmpDb.pragma('journal_mode = DELETE') // rekey requires a non-WAL journal mode
      tmpDb.pragma(`rekey='${quoteSqlLiteral(dek)}'`)
    } finally {
      tmpDb.close()
    }
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

  // Step 5: back up the original -- this MUST exist before the swap.
  const backupPath = `${path}.plaintext-backup-${Date.now()}`
  try {
    copyFileSync(path, backupPath)
    copySidecarsIfPresent(path, backupPath)
    const stat = statSync(backupPath)
    if (stat.size === 0) {
      throw new Error('Backup file was created but is empty')
    }
  } catch (error) {
    cleanupFile(backupPath)
    return rollbackBeforeSwap(error)
  }

  // Step 6: atomic swap.
  try {
    renameSync(tmpPath, path)
  } catch (error) {
    return rollbackAfterSwap(path, backupPath, tmpPath, keyId, keyStore, error)
  }

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
