/**
 * A kill between a migration's ALTER TABLE and its `PRAGMA user_version`
 * leaves the columns in place with the old version; the next start replays the
 * migration and must not fail with "duplicate column name" (#505).
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { describe, expect, it } from 'vitest'

import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

describe('migration replay after a kill before the version bump', () => {
  it.each([3, 27])('replays v%i over its already-added columns', (version) => {
    const db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
    db.pragma(`user_version = ${version - 1}`)

    expect(() => runMigrations(db)).not.toThrow()

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    db.close()
  })
})
