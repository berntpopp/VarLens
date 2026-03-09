import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import { BaseRepository } from '../../../src/main/database/BaseRepository'
import { createKysely } from '../../../src/main/database/kysely'
import type { Kysely } from 'kysely'
import type { VarlensDatabase } from '../../../src/shared/types/database-schema'

class TestRepository extends BaseRepository {
  createTable(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, name TEXT)')
  }

  insert(name: string): number {
    const result = this.db.prepare('INSERT INTO test_items (name) VALUES (?)').run(name)
    return Number(result.lastInsertRowid)
  }

  get(id: number): { id: number; name: string } | undefined {
    return this.db.prepare('SELECT * FROM test_items WHERE id = ?').get(id) as
      | { id: number; name: string }
      | undefined
  }

  insertTwo(name1: string, name2: string): void {
    this.runTransaction(() => {
      this.db.prepare('INSERT INTO test_items (name) VALUES (?)').run(name1)
      this.db.prepare('INSERT INTO test_items (name) VALUES (?)').run(name2)
    })
  }
}

describe('BaseRepository', () => {
  let db: Database.Database
  let kysely: Kysely<VarlensDatabase>
  let repo: TestRepository

  beforeEach(() => {
    db = new Database(':memory:')
    kysely = createKysely(db)
    repo = new TestRepository(db, kysely)
    repo.createTable()
  })

  afterEach(() => {
    db.close()
  })

  it('inserts and retrieves records via db.prepare', () => {
    const id = repo.insert('a')
    const row = repo.get(id)
    expect(row?.name).toBe('a')
  })

  it('runs transactions atomically', () => {
    repo.insertTwo('x', 'y')
    const x = repo.get(1)
    const y = repo.get(2)
    expect(x?.name).toBe('x')
    expect(y?.name).toBe('y')
  })

  it('rolls back transaction on error', () => {
    db.exec('CREATE UNIQUE INDEX idx_name ON test_items(name)')
    repo.insert('dup')
    expect(() => repo.insertTwo('dup', 'other')).toThrow()
    const all = db.prepare('SELECT * FROM test_items').all()
    expect(all).toHaveLength(1)
  })
})
