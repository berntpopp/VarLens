/**
 * Connection setup shared by the main-process DatabaseService and the
 * migration worker, so a database the worker creates or migrates gets the
 * exact same key, page size and journal settings as one opened on main.
 *
 * No MainLogger / Electron imports: also loaded inside worker threads.
 */
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { DATABASE_CONFIG } from '../../shared/config'

/**
 * Apply the encryption key (must be the FIRST pragma) and the standard
 * connection pragmas. `page_size` only takes effect on a new database and must
 * precede `journal_mode = WAL` and any table creation.
 */
export function applyConnectionPragmas(db: DatabaseType, encryptionKey?: string): void {
  if (encryptionKey !== undefined && encryptionKey !== '') {
    const safeKey = encryptionKey.split("'").join("''")
    db.pragma(`key='${safeKey}'`)
  }

  db.pragma(`page_size = ${DATABASE_CONFIG.PAGE_SIZE}`)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma(`busy_timeout = ${DATABASE_CONFIG.BUSY_TIMEOUT_MS}`)
  db.pragma(`cache_size = ${DATABASE_CONFIG.CACHE_SIZE_KB}`)
  db.pragma('temp_store = MEMORY')
  db.pragma(`mmap_size = ${DATABASE_CONFIG.MMAP_SIZE_BYTES}`)
  db.pragma(`analysis_limit = ${DATABASE_CONFIG.ANALYSIS_LIMIT}`)
  db.pragma('journal_size_limit = 6144000') // 6 MB — prevents WAL bloat
}
