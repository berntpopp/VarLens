import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import type { Database as DatabaseType } from 'better-sqlite3-multiple-ciphers'
import {
  deleteCasesIncrementally,
  listAllCaseIds
} from '../../../src/main/workers/delete-operations'

function variantPositions(db: DatabaseType): number[] {
  return (db.prepare('SELECT pos FROM variants ORDER BY pos').all() as { pos: number }[]).map(
    (r) => r.pos
  )
}

describe('delete-operations', () => {
  let db: DatabaseType
  const progress: Array<[number, number]> = []
  const options = (overrides: Partial<Parameters<typeof deleteCasesIncrementally>[2]> = {}) => ({
    isCancelled: () => false,
    onProgress: (current: number, total: number) => {
      progress.push([current, total])
    },
    ...overrides
  })

  beforeEach(() => {
    progress.length = 0
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE cases (
        id INTEGER PRIMARY KEY, name TEXT, import_status TEXT NOT NULL DEFAULT 'ready'
      );
      CREATE TABLE variants (
        id INTEGER PRIMARY KEY,
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
        chr TEXT, pos INTEGER, ref TEXT, alt TEXT
      );
      INSERT INTO cases (name) VALUES ('case1'), ('case2'), ('case3');
      -- pos 100 is shared by cases 1+2, pos 200 only in case 1, pos 300 in case 3
      INSERT INTO variants (case_id, chr, pos, ref, alt) VALUES
        (1, '1', 100, 'A', 'G'), (1, '1', 200, 'C', 'T'),
        (2, '1', 100, 'A', 'G'),
        (3, '1', 300, 'G', 'A');
    `)
  })

  afterEach(() => {
    db.close()
  })

  it('lists every case id in order', () => {
    expect(listAllCaseIds(db)).toEqual([1, 2, 3])
  })

  it('deletes the requested cases with their variants', async () => {
    const result = await deleteCasesIncrementally(db, [1], options())

    expect(result).toEqual({ deleted: 1, cancelled: false })
    expect(listAllCaseIds(db)).toEqual([2, 3])
    expect(variantPositions(db)).toEqual([100, 300])
    expect(progress).toEqual([
      [0, 1],
      [1, 1]
    ])
  })

  it('stops between cases when cancelled and reports the partial count', async () => {
    let calls = 0
    const result = await deleteCasesIncrementally(
      db,
      [1, 2, 3],
      options({ isCancelled: () => calls++ >= 1 })
    )

    expect(result).toEqual({ deleted: 1, cancelled: true })
    expect(listAllCaseIds(db)).toEqual([2, 3])
    expect(variantPositions(db)).toEqual([100, 300])
  })

  it('deletes every case', async () => {
    const result = await deleteCasesIncrementally(db, listAllCaseIds(db), options())

    expect(result).toEqual({ deleted: 3, cancelled: false })
    expect(variantPositions(db)).toEqual([])
  })

  it('keeps the cases a cancelled delete-all did not reach', async () => {
    let calls = 0
    const result = await deleteCasesIncrementally(
      db,
      listAllCaseIds(db),
      options({ isCancelled: () => calls++ >= 2 })
    )

    expect(result).toEqual({ deleted: 2, cancelled: true })
    expect(listAllCaseIds(db)).toEqual([3])
    expect(variantPositions(db)).toEqual([300])
  })

  it('ignores ids that do not exist', async () => {
    const result = await deleteCasesIncrementally(db, [99, 100], options())
    expect(result).toEqual({ deleted: 0, cancelled: false })
    expect(listAllCaseIds(db)).toEqual([1, 2, 3])
  })
})
