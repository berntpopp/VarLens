/**
 * Migration v54 (#570): built-in presets are renamed after the clinical
 * question they answer and get a one-line description (mirrors PG 0037).
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BUILT_IN_PRESETS,
  BUILT_IN_PRESET_RENAMES_V54
} from '../../../src/shared/config/filter-presets.config'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

interface Row {
  name: string
  description: string | null
  is_built_in: number
  is_visible: number
}

describe('migration v54: built-in presets named by clinical question', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  const builtIns = (): Row[] =>
    db
      .prepare(
        `SELECT name, description, is_built_in, is_visible FROM filter_presets
          WHERE is_built_in = 1 AND kind = 'filter' ORDER BY sort_order`
      )
      .all() as Row[]

  /** Put the database back to v53 with the pre-#570 names. */
  function backToV53(): void {
    const rename = db.prepare('UPDATE filter_presets SET name = ?, description = ? WHERE name = ?')
    for (const [oldName, newName] of BUILT_IN_PRESET_RENAMES_V54) {
      rename.run(oldName, 'old description', newName)
    }
    db.exec('PRAGMA user_version = 53')
  }

  it('every built-in preset has a description, on a new database', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SQLITE_SCHEMA_VERSION)
    const rows = builtIns()
    expect(rows.map((r) => r.name)).toEqual(BUILT_IN_PRESETS.map((p) => p.name))
    for (const row of rows) expect(row.description?.length ?? 0).toBeGreaterThan(0)
  })

  it('renames the old built-ins, keeps visibility, leaves user presets alone', () => {
    backToV53()
    db.exec("UPDATE filter_presets SET is_visible = 0 WHERE name = 'Rare HIGH'")
    const now = Date.now()
    db.prepare(
      `INSERT INTO filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES ('Rare HIGH copy', 'mine', '{}', 0, 1, 20, ?, ?)`
    ).run(now, now)

    runMigrations(db)

    expect(builtIns()).toEqual(
      BUILT_IN_PRESETS.map((p) => ({
        name: p.name,
        description: p.description,
        is_built_in: 1,
        is_visible: p.name === 'Rare loss-of-function' ? 0 : 1
      }))
    )
    expect(
      db.prepare("SELECT description FROM filter_presets WHERE name = 'Rare HIGH copy'").get()
    ).toEqual({ description: 'mine' })
  })

  it('keeps the old built-in name when a user preset already has the new one', () => {
    backToV53()
    const now = Date.now()
    db.prepare(
      `INSERT INTO filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES ('Known pathogenic', 'mine', '{}', 0, 1, 20, ?, ?)`
    ).run(now, now)

    expect(() => runMigrations(db)).not.toThrow()
    const names = db.prepare('SELECT name, is_built_in FROM filter_presets').all()
    expect(names).toContainEqual({ name: 'ClinVar P/LP', is_built_in: 1 })
    expect(names).toContainEqual({ name: 'Known pathogenic', is_built_in: 0 })
  })

  it('does not fail on a database without a filter_presets table', () => {
    db.exec('DROP TABLE filter_presets')
    db.exec('PRAGMA user_version = 53')
    expect(() => runMigrations(db)).not.toThrow()
  })
})
