/**
 * Cases & Database IPC handler integration tests
 *
 * Tests cases:query handler and database:overview pool migration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseService } from '../../../src/main/database/DatabaseService'

describe('cases IPC handlers', () => {
  let db: DatabaseService

  // Helper to insert a case
  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 5, Date.now())
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  /* eslint-disable @typescript-eslint/no-explicit-any */
  describe('cases:query', () => {
    it('returns paginated results with valid params', () => {
      insertCase('Case Alpha')
      insertCase('Case Beta')
      insertCase('Case Gamma')

      const result = (db.cases as any).queryCases({ limit: 2, offset: 0 })
      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(3)
    })

    it('applies search filter', () => {
      insertCase('Case Alpha')
      insertCase('Case Beta')
      insertCase('Different Name')

      const result = (db.cases as any).queryCases({
        search_term: 'Case',
        limit: 50,
        offset: 0
      })
      expect(result.data).toHaveLength(2)
      expect(result.total_count).toBe(2)
      expect(result.data.every((c: any) => c.name.includes('Case'))).toBe(true)
    })

    it('handles offset pagination', () => {
      insertCase('Case A')
      insertCase('Case B')
      insertCase('Case C')

      const page1 = (db.cases as any).queryCases({ limit: 2, offset: 0 })
      const page2 = (db.cases as any).queryCases({ limit: 2, offset: 2 })

      expect(page1.data).toHaveLength(2)
      expect(page2.data).toHaveLength(1)
      expect(page1.total_count).toBe(3)
      expect(page2.total_count).toBe(3)
    })

    it('returns empty results when no cases match search', () => {
      insertCase('Alpha')
      insertCase('Beta')

      const result = (db.cases as any).queryCases({
        search_term: 'zzz_nonexistent',
        limit: 50,
        offset: 0
      })
      expect(result.data).toHaveLength(0)
      expect(result.total_count).toBe(0)
    })
  })
  /* eslint-enable @typescript-eslint/no-explicit-any */
})

describe('database:overview handler', () => {
  let db: DatabaseService

  const insertCase = (name: string): number => {
    const result = db.database
      .prepare(
        'INSERT INTO cases (name, file_path, file_size, variant_count, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(name, `/test/path/${name}.json`, 1000, 5, Date.now())
    return result.lastInsertRowid as number
  }

  beforeEach(() => {
    db = new DatabaseService(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('returns overview with BigInt serialized to Number', () => {
    insertCase('Test Case 1')
    insertCase('Test Case 2')

    const overview = db.overview.getDatabaseOverview()
    // Simulate the BigInt serialization that the handler does
    const serialized = JSON.parse(
      JSON.stringify(overview, (_key, value) => (typeof value === 'bigint' ? Number(value) : value))
    )

    expect(serialized.cases).toHaveLength(2)
    expect(serialized.summary).toBeDefined()
    expect(serialized.summary.total_cases).toBe(2)
  })

  it('returns empty overview when no cases exist', () => {
    const overview = db.overview.getDatabaseOverview()
    const serialized = JSON.parse(
      JSON.stringify(overview, (_key, value) => (typeof value === 'bigint' ? Number(value) : value))
    )

    expect(serialized.cases).toHaveLength(0)
    expect(serialized.summary.total_cases).toBe(0)
  })
})
