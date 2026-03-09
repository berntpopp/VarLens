import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Statement } from 'better-sqlite3-multiple-ciphers'
import { BaseRepository } from '../../../src/main/database/BaseRepository'
import { createKysely } from '../../../src/main/database/kysely'

class TestRepository extends BaseRepository {
  createTable(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, name TEXT)')
  }

  insert(name: string): number {
    const result = this.stmt('INSERT INTO test_items (name) VALUES (?)').run(name)
    return Number(result.lastInsertRowid)
  }

  get(id: number): { id: number; name: string } | undefined {
    return this.stmt('SELECT * FROM test_items WHERE id = ?').get(id) as
      | { id: number; name: string }
      | undefined
  }

  insertTwo(name1: string, name2: string): void {
    this.runTransaction(() => {
      this.stmt('INSERT INTO test_items (name) VALUES (?)').run(name1)
      this.stmt('INSERT INTO test_items (name) VALUES (?)').run(name2)
    })
  }
}

describe('BaseRepository', () => {
  let db: Database.Database
  let cache: Map<string, Statement>
  let repo: TestRepository

  beforeEach(() => {
    db = new Database(':memory:')
    cache = new Map()
    repo = new TestRepository(db, createKysely(db), cache)
    repo.createTable()
  })

  afterEach(() => {
    db.close()
  })

  it('caches prepared statements', () => {
    repo.insert('a')
    repo.insert('b')
    expect(cache.size).toBe(1)
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
