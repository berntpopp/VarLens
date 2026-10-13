/**
 * Migration v51 (mirrors PG 0034): import integrity. A fresh database and one
 * upgraded from v49 end in the same state.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

describe('migration v51: import integrity', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  const hasObject = (type: string, name: string): boolean =>
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name) !==
    undefined

  /** Put the database back to v49 as the previous release left it. */
  function backToV49(): void {
    db.exec(`
      CREATE TABLE variant_frequency (
        chr TEXT NOT NULL, pos INTEGER NOT NULL, ref TEXT NOT NULL, alt TEXT NOT NULL,
        case_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (chr, pos, ref, alt)
      );
      INSERT INTO variant_frequency VALUES ('chr1', 100, 'A', 'G', 3);
      PRAGMA user_version = 49;
    `)
  }

  it('is the latest schema version', () => {
    expect(LATEST_SQLITE_SCHEMA_VERSION).toBe(51)
    expect(db.pragma('user_version', { simple: true })).toBe(51)
  })

  it('a new database has no variant_frequency table (#595)', () => {
    expect(hasObject('table', 'variant_frequency')).toBe(false)
  })

  it('an upgraded database loses variant_frequency (#595)', () => {
    backToV49()
    runMigrations(db)
    expect(hasObject('table', 'variant_frequency')).toBe(false)
    expect(db.pragma('user_version', { simple: true })).toBe(51)
  })
})
