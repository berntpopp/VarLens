/**
 * Self-repair of the derived cohort-summary keys, run after every migration
 * pass (cheap: two PRAGMA reads when the keys are right).
 *
 * Found on real data: a desktop database at v32 still had the pre-v25 keys
 * (cohort_variant_summary PK chr,pos,ref,alt; gene_burden_summary PK
 * gene_symbol) although v25 replaces them, so the summary rebuild failed with a
 * UNIQUE constraint once a coordinate was both an indel and an SV, or a
 * coordinate or gene was in two builds. The tables are derived from `variants`,
 * so a wrong key is fixed by recreating the table with the right one (same
 * columns and indexes, no rows) and flagging the summary stale; the existing
 * rebuild fills it again.
 */
import type Database from 'better-sqlite3-multiple-ciphers'

import { MARK_STALE_SQL } from '../../shared/sql/cohort-summary-rebuild'
import { mainLogger } from '../services/MainLogger'

type Db = Database.Database

const EXPECTED_KEYS: Readonly<Record<string, readonly string[]>> = {
  cohort_variant_summary: ['chr', 'pos', 'ref', 'alt', 'variant_type', 'genome_build'],
  gene_burden_summary: ['gene_symbol', 'genome_build']
}

interface Column {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

function recreateWithKey(db: Db, table: string, columns: Column[], key: readonly string[]): void {
  const indexes = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL"
    )
    .pluck()
    .all(table) as string[]
  const defs = columns.map(
    (c) =>
      `"${c.name}" ${c.type}${c.notnull === 1 ? ' NOT NULL' : ''}${c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : ''}`
  )
  // Triggers of other tables that write this one would fail the rename while it is gone.
  const triggers = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE ?")
    .all(`%${table}%`) as Array<{ name: string; sql: string }>
  const keyList = key.map((k) => `"${k}"`).join(', ')
  db.transaction(() => {
    for (const t of triggers) db.exec(`DROP TRIGGER "${t.name}"`)
    db.exec(`CREATE TABLE "${table}__rekey" (${defs.join(', ')}, PRIMARY KEY (${keyList}))`)
    db.exec(`DROP TABLE "${table}"`)
    db.exec(`ALTER TABLE "${table}__rekey" RENAME TO "${table}"`)
    for (const sql of indexes) db.exec(sql)
    for (const t of triggers) db.exec(t.sql)
  })()
}

/** Restore the summary tables' keys where they drifted. Returns the tables repaired. */
export function repairSummaryKeys(db: Db): string[] {
  const repaired: string[] = []
  for (const [table, key] of Object.entries(EXPECTED_KEYS)) {
    const columns = db.prepare(`PRAGMA table_info('${table}')`).all() as Column[]
    if (columns.length === 0) continue
    const current = columns
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    if (current.join() === key.join()) continue
    if (!key.every((k) => columns.some((c) => c.name === k))) {
      mainLogger.warn(`${table} lacks a key column of ${key.join(', ')}; left as is`, 'database')
      continue
    }
    recreateWithKey(db, table, columns, key)
    repaired.push(table)
  }
  if (repaired.length > 0) {
    db.exec(MARK_STALE_SQL)
    mainLogger.warn(
      `Restored the primary key of ${repaired.join(', ')} (it predated migration v25); the cohort summary is rebuilt`,
      'database'
    )
  }
  return repaired
}
