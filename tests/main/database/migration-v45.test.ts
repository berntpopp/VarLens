/**
 * Migration v45 (#455): the built-in preset "Rare, not recurrent" is added to
 * existing databases. Every other preset row stays as it is.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BUILT_IN_PRESETS,
  RARE_NOT_RECURRENT_PRESET_NAME
} from '../../../src/main/database/built-in-presets'
import { LATEST_SQLITE_SCHEMA_VERSION, runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

interface PresetRow {
  name: string
  description: string | null
  filter_json: string
  is_built_in: number
  is_visible: number
  sort_order: number
  kind: string
}

describe('migration v45: built-in preset "Rare, not recurrent"', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  const preset = (): PresetRow[] =>
    db
      .prepare(
        `SELECT name, description, filter_json, is_built_in, is_visible, sort_order, kind
           FROM filter_presets WHERE name = ?`
      )
      .all(RARE_NOT_RECURRENT_PRESET_NAME) as PresetRow[]

  const otherRows = (): unknown[] =>
    db
      .prepare('SELECT * FROM filter_presets WHERE name != ? ORDER BY id')
      .all(RARE_NOT_RECURRENT_PRESET_NAME)

  /** Put the database back to v44, before the preset existed. */
  function backToV44(): void {
    db.prepare('DELETE FROM filter_presets WHERE name = ?').run(RARE_NOT_RECURRENT_PRESET_NAME)
    db.exec('PRAGMA user_version = 44')
  }

  it('is the latest schema version', () => {
    expect(LATEST_SQLITE_SCHEMA_VERSION).toBe(45)
    expect(db.pragma('user_version', { simple: true })).toBe(45)
  })

  it('a new database has the preset once, after the eight existing built-ins', () => {
    expect(preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'gnomAD AF <= 1% + seen in at most 3 cases',
        filter_json: '{"maxGnomadAf":0.01,"maxCarriers":3}',
        is_built_in: 1,
        is_visible: 1,
        sort_order: 8,
        kind: 'filter'
      }
    ])
    const classic = db
      .prepare(
        "SELECT name FROM filter_presets WHERE is_built_in = 1 AND kind = 'filter' ORDER BY sort_order"
      )
      .all() as Array<{ name: string }>
    expect(classic.map((row) => row.name)).toEqual(BUILT_IN_PRESETS.map((p) => p.name))
    expect(classic).toHaveLength(9)
  })

  it('adds the preset to a v44 database and leaves every other row unchanged', () => {
    backToV44()
    const now = Date.now()
    db.prepare(
      `INSERT INTO filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES ('My rare set', 'mine', '{"maxGnomadAf":0.001,"maxCarriers":2}', 0, 1, 20, ?, ?)`
    ).run(now, now)
    db.exec("UPDATE filter_presets SET is_visible = 0 WHERE name = 'Rare (1%)'")
    const before = otherRows()
    expect(preset()).toEqual([])

    runMigrations(db)

    expect(db.pragma('user_version', { simple: true })).toBe(45)
    expect(preset()).toHaveLength(1)
    expect(preset()[0]).toMatchObject({ is_built_in: 1, sort_order: 8, kind: 'filter' })
    expect(otherRows()).toEqual(before)
  })

  // Review Focus 5
  it('keeps a user preset of the same name as it is', () => {
    backToV44()
    const now = Date.now()
    db.prepare(
      `INSERT INTO filter_presets
         (name, description, filter_json, is_built_in, is_visible, sort_order, created_at, updated_at)
       VALUES (?, 'my own', '{"minCadd":5}', 0, 1, 30, ?, ?)`
    ).run(RARE_NOT_RECURRENT_PRESET_NAME, now, now)

    runMigrations(db)

    expect(preset()).toEqual([
      {
        name: 'Rare, not recurrent',
        description: 'my own',
        filter_json: '{"minCadd":5}',
        is_built_in: 0,
        is_visible: 1,
        sort_order: 30,
        kind: 'filter'
      }
    ])
  })

  it('replaying the migration does not add a second row', () => {
    db.exec('PRAGMA user_version = 44')
    runMigrations(db)
    expect(preset()).toHaveLength(1)
  })

  // Review Focus 5
  it('does not fail on a database without a filter_presets table', () => {
    db.exec('DROP TABLE filter_presets')
    db.exec('PRAGMA user_version = 44')
    expect(() => runMigrations(db)).not.toThrow()
    expect(db.pragma('user_version', { simple: true })).toBe(45)
  })
})
