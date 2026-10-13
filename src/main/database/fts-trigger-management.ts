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

/** Run the FTS5 `('rebuild')` command on every present FTS table. */
export function rebuildAllFtsIndexes(db: DatabaseType): void {
  const present = detectPresentFtsTables(db)
  for (const ftsTable of present) {
    db.exec(`INSERT INTO ${ftsTable}(${ftsTable}) VALUES('rebuild')`)
  }
}
