/**
 * Migration v55 (#125): the default quick-flag tags are seeded once, only
 * where no tag of that name exists in any letter case (mirrors PG 0038).
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_TAGS } from '../../../src/shared/config/default-tags.config'
import { runMigrations } from '../../../src/main/database/migrations'
import { initializeSchema } from '../../../src/main/database/schema'

describe('migration v55: default tags', () => {
  let db: InstanceType<typeof Database>

  beforeEach(() => {
    db = new Database(':memory:')
    initializeSchema(db)
    runMigrations(db)
  })

  afterEach(() => db.close())

  const tags = (): Array<{ name: string; color: string }> =>
    db.prepare('SELECT name, color FROM tags ORDER BY id').all() as Array<{
      name: string
      color: string
    }>

  it('a new database has the four default tags', () => {
    expect(tags()).toEqual(DEFAULT_TAGS.map(({ name, color }) => ({ name, color })))
  })

  it('keeps user tags and skips a default whose name a user already has', () => {
    db.exec('DELETE FROM tags')
    db.prepare("INSERT INTO tags (name, color, created_at) VALUES ('reported', '#000000', 1)").run()
    db.prepare("INSERT INTO tags (name, color, created_at) VALUES ('Mine', '#111111', 1)").run()
    db.exec('PRAGMA user_version = 54')

    runMigrations(db)

    expect(tags()).toEqual([
      { name: 'reported', color: '#000000' },
      { name: 'Mine', color: '#111111' },
      ...DEFAULT_TAGS.filter((t) => t.name !== 'Reported').map(({ name, color }) => ({
        name,
        color
      }))
    ])
  })

  it('does not bring back a default tag the user deleted', () => {
    db.exec("DELETE FROM tags WHERE name = 'Reported'")
    runMigrations(db)
    expect(tags().map((t) => t.name)).not.toContain('Reported')
  })
})
