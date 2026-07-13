/**
 * Shared detection for SQLite's SQLITE_NOTADB failure.
 *
 * SQLCipher-backed SQLite cannot distinguish "wrong or missing encryption
 * key" from "genuinely corrupt/unreadable file" -- both produce the exact
 * same error (code `SQLITE_NOTADB`, message `file is not a database`). Any
 * file that trips this is treated as "needs a password so the caller can
 * prompt"; a truly corrupt file just keeps failing on every attempted key,
 * which is the same tradeoff every SQLCipher-based application makes.
 *
 * The error may arrive wrapped one level deep in a `DatabaseError` (see
 * `DatabaseService`'s constructor, which wraps any pragma/init failure), so
 * this checks both the error itself and its `.cause`.
 */
export function isNotADatabaseError(error: unknown): boolean {
  return hasNotADatabaseSignature(error) || hasNotADatabaseSignature(getCause(error))
}

function getCause(error: unknown): unknown {
  if (error !== null && typeof error === 'object' && 'cause' in error) {
    return (error as { cause?: unknown }).cause
  }
  return undefined
}

function hasNotADatabaseSignature(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const code = (error as Error & { code?: unknown }).code
  if (code === 'SQLITE_NOTADB') {
    return true
  }
  return error.message.includes('file is not a database')
}
