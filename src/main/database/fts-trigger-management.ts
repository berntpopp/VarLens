import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import { EXTENSION_FTS_TABLES } from './variant-extension-registry'

const BASE_FTS_TABLE = 'variants_fts'

/** Map of trigger name → CREATE TRIGGER SQL for restoration. */
export type TriggerSnapshot = Record<string, string>

/**
 * Query sqlite_master for FTS tables that exist right now. Safe to call
 * before migration v26 applies — returns only variants_fts in that case.
 */
export function detectPresentFtsTables(db: DatabaseType): string[] {
  const expected = [BASE_FTS_TABLE, ...EXTENSION_FTS_TABLES.map((e) => e.ftsTable)]
  const placeholders = expected.map(() => '?').join(', ')
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
    .all(...expected) as { name: string }[]
  return rows.map((r) => r.name)
}

/**
 * Drop ai/au/ad triggers for every present FTS table. Returns a snapshot
 * keyed by trigger name so restoreFtsTriggers can rebuild them.
 */
export function tearDownFtsTriggers(db: DatabaseType): TriggerSnapshot {
  const present = detectPresentFtsTables(db)
  const snapshot: TriggerSnapshot = {}
  for (const ftsTable of present) {
    for (const suffix of ['_ai', '_au', '_ad']) {
      const triggerName = `${ftsTable}${suffix}`
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
        .get(triggerName) as { sql: string } | undefined
      if (row !== undefined && row.sql !== null) {
        snapshot[triggerName] = row.sql
      }
      db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`)
    }
  }
  return snapshot
}

/** True when every present FTS table has its insert/update/delete triggers. */
export function ftsTriggersComplete(db: DatabaseType): boolean {
  const names = detectPresentFtsTables(db).flatMap((t) => [`${t}_ai`, `${t}_au`, `${t}_ad`])
  const found = db
    .prepare(
      `SELECT COUNT(*) AS c FROM sqlite_master
        WHERE type = 'trigger' AND name IN (${names.map(() => '?').join(', ')})`
    )
    .get(...names) as { c: number }
  return found.c === names.length
}

/** Recreate triggers from a snapshot produced by tearDownFtsTriggers. */
export function restoreFtsTriggers(db: DatabaseType, snapshot: TriggerSnapshot): void {
  for (const sql of Object.values(snapshot)) {
    db.exec(sql)
  }
}

/**
 * Create the row triggers of every present extension FTS table (v26) that
 * lacks them. A torn-down bracket that never restored its snapshot lost them
 * for good (#551); the columns come from the FTS table itself.
 */
export function ensureExtensionFtsTriggers(db: DatabaseType): void {
  const present = new Set(detectPresentFtsTables(db))
  for (const { ftsTable: t, sourceTable: src } of EXTENSION_FTS_TABLES) {
    if (!present.has(t)) continue
    const cols = ftsColumns(db, t)
    const list = cols.join(', ')
    const values = (row: 'new' | 'old'): string => cols.map((c) => `${row}.${c}`).join(', ')
    const remove = `INSERT INTO ${t}(${t}, rowid, ${list}) VALUES ('delete', old.variant_id, ${values('old')});`
    const add = `INSERT INTO ${t}(rowid, ${list}) VALUES (new.variant_id, ${values('new')});`
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${t}_ai AFTER INSERT ON ${src} BEGIN ${add} END;
      CREATE TRIGGER IF NOT EXISTS ${t}_au AFTER UPDATE ON ${src} BEGIN ${remove} ${add} END;
      CREATE TRIGGER IF NOT EXISTS ${t}_ad AFTER DELETE ON ${src} BEGIN ${remove} END;
    `)
  }
}

/** Columns of an FTS table; the same names exist in its content table. */
function ftsColumns(db: DatabaseType, ftsTable: string): string[] {
  return (db.prepare(`PRAGMA table_info(${ftsTable})`).all() as { name: string }[]).map(
    (c) => c.name
  )
}

/**
 * Index the rows above `watermark` (a variants id) in every present FTS table:
 * the rows a session inserted while the triggers were down (#559).
 */
export function indexFtsRowsAbove(db: DatabaseType, watermark: number): void {
  const extension = new Map(EXTENSION_FTS_TABLES.map((e) => [e.ftsTable, e.sourceTable]))
  for (const t of detectPresentFtsTables(db)) {
    const [src, key] = t === BASE_FTS_TABLE ? ['variants', 'id'] : [extension.get(t), 'variant_id']
    const list = ftsColumns(db, t).join(', ')
    db.prepare(
      `INSERT INTO ${t}(rowid, ${list}) SELECT ${key}, ${list} FROM ${src} WHERE ${key} > ?`
    ).run(watermark)
  }
}

/** Run the FTS5 `('rebuild')` command on every present FTS table. */
export function rebuildAllFtsIndexes(db: DatabaseType): void {
  const present = detectPresentFtsTables(db)
  for (const ftsTable of present) {
    db.exec(`INSERT INTO ${ftsTable}(${ftsTable}) VALUES('rebuild')`)
  }
}
