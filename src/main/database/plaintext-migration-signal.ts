/**
 * plaintext-migration-signal.ts -- content-signal computation for
 * `plaintext-migration.ts`.
 *
 * Split out of `plaintext-migration.ts` to keep that file under the repo's
 * LLM-sustainable size guideline; this module has one reason to change:
 * "how do we prove two SQLite files hold the same logical data." It knows
 * nothing about migration steps, rollback, or key-store lifecycle.
 */

import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { createHash } from 'crypto'

/** A structural + content fingerprint of a SQLite database's user tables. */
export interface ContentSignal {
  userVersion: number
  tableRowCounts: Record<string, number>
  /** Per-table content hash -- see `computeTableContentHash` for the approach. */
  tableContentHashes: Record<string, string>
}

function quoteIdentifier(name: string): string {
  return name.replace(/"/g, '""')
}

/**
 * Content hash for one table: a SHA-256 over every row's values, ordered
 * deterministically and type-tagged so e.g. the integer `1`, the text `'1'`,
 * and `NULL` can never collide.
 *
 * APPROACH (documented per the I2b hardening review -- a same-cardinality
 * content divergence, e.g. an UPDATE that changes a value without changing
 * row count, is exactly what a plain `COUNT(*)` cannot catch):
 *   - Row order: `ORDER BY rowid` when the table has one -- cheap (a normal
 *     table scan needs no explicit sort) and correct for this module's only
 *     use case, comparing files that started life as byte-identical copies
 *     of one another (the original, its encrypting candidate, and its
 *     backup), so rowid order is guaranteed to line up across all three.
 *     Falls back to ordering by every column for `WITHOUT ROWID` tables,
 *     which have no rowid.
 *   - Per value: a self-describing, LENGTH-PREFIXED frame
 *     (`<tag>:<byteLength>:<bytes>`, tag one of `N` null / `B` blob /
 *     `F` number / `T` text). Length-prefixing (rather than a delimiter
 *     character) makes the concatenated byte stream unambiguous regardless
 *     of what bytes a value itself contains -- no in-band separator can ever
 *     be confused with real data, and a table's fixed column count per row
 *     makes the whole per-table stream self-delimiting without needing an
 *     explicit row separator either. This is a logical-content hash, not a
 *     byte-perfect binary one (e.g. INTEGER `1` and REAL `1.0` both
 *     stringify to `'1'`) -- an acceptable tradeoff for a same-machine,
 *     same-SQLite-build migration integrity check, not a general-purpose
 *     content-addressing scheme.
 *   - Cost: one full table scan per table, the same asymptotic cost as the
 *     pre-existing `COUNT(*)` pass this augments -- just a heavier per-row
 *     constant (hashing instead of counting).
 */
function computeTableContentHash(
  db: DatabaseType,
  tableName: string,
  columns: string[],
  withoutRowid: boolean
): string {
  const quotedTable = quoteIdentifier(tableName)
  const columnList = columns.map((c) => `"${quoteIdentifier(c)}"`).join(', ')

  const orderBy = withoutRowid ? columnList : 'rowid'
  const rows = db
    .prepare(`SELECT ${columnList} FROM "${quotedTable}" ORDER BY ${orderBy}`)
    .iterate() as Iterable<Record<string, unknown>>

  const hash = createHash('sha256')
  for (const row of rows) {
    for (const col of columns) {
      hashOneValue(hash, row[col])
    }
  }
  return hash.digest('hex')
}

/** Feed one SQLite value into `hash` as a length-prefixed frame -- see `computeTableContentHash`. */
function hashOneValue(hash: ReturnType<typeof createHash>, value: unknown): void {
  if (value === null || value === undefined) {
    hash.update('N:0:')
    return
  }
  const isBlob = Buffer.isBuffer(value)
  const bytes = isBlob ? value : Buffer.from(String(value), 'utf8')
  const tag = isBlob ? 'B' : typeof value === 'number' || typeof value === 'bigint' ? 'F' : 'T'
  hash.update(`${tag}:${bytes.length}:`)
  hash.update(bytes)
}

/** Compute a `ContentSignal` for every user table on an already-open connection. */
export function computeContentSignal(db: DatabaseType): ContentSignal {
  const tables = db
    .prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    )
    .all() as Array<{ name: string; sql: string | null }>

  const tableRowCounts: Record<string, number> = {}
  const tableContentHashes: Record<string, string> = {}
  for (const { name, sql } of tables) {
    const row = db.prepare(`SELECT COUNT(*) as c FROM "${quoteIdentifier(name)}"`).get() as {
      c: number
    }
    tableRowCounts[name] = row.c

    const columns = (
      db.prepare(`PRAGMA table_info("${quoteIdentifier(name)}")`).all() as Array<{ name: string }>
    ).map((c) => c.name)
    tableContentHashes[name] = computeTableContentHash(
      db,
      name,
      columns,
      /\bWITHOUT\s+ROWID\b/i.test(sql ?? '')
    )
  }

  const userVersion = db.pragma('user_version', { simple: true }) as number
  return { userVersion, tableRowCounts, tableContentHashes }
}

/** Two signals match iff `user_version`, every table's row count, AND every table's content hash agree. */
export function signalsMatch(a: ContentSignal, b: ContentSignal): boolean {
  if (a.userVersion !== b.userVersion) {
    return false
  }
  const aKeys = Object.keys(a.tableRowCounts)
  const bKeys = Object.keys(b.tableRowCounts)
  if (aKeys.length !== bKeys.length) {
    return false
  }
  return aKeys.every(
    (key) =>
      a.tableRowCounts[key] === b.tableRowCounts[key] &&
      a.tableContentHashes[key] === b.tableContentHashes[key]
  )
}
