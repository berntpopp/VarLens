import { describe, expect, it, vi } from 'vitest'

import { computeContentSignal } from '../../../src/main/database/plaintext-migration-signal'

describe('plaintext migration content signal', () => {
  it('streams user-table rows and never materializes the table with all()', () => {
    const rowStatement = {
      all: vi.fn(() => {
        throw new Error('table rows must not be materialized')
      }),
      iterate: vi.fn(function* () {
        yield { id: 1, label: 'alpha' }
        yield { id: 2, label: 'beta' }
      })
    }
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('sqlite_master')) {
        return { all: () => [{ name: 'marker', sql: 'CREATE TABLE marker (id, label)' }] }
      }
      if (sql.includes('COUNT(*)')) return { get: () => ({ c: 2 }) }
      if (sql.includes('PRAGMA table_info'))
        return { all: () => [{ name: 'id' }, { name: 'label' }] }
      if (sql.startsWith('SELECT "id", "label"')) return rowStatement
      throw new Error(`Unexpected SQL: ${sql}`)
    })
    const db = {
      prepare,
      pragma: vi.fn().mockReturnValue(7)
    }

    const signal = computeContentSignal(db as never)

    expect(signal.userVersion).toBe(7)
    expect(signal.tableRowCounts).toEqual({ marker: 2 })
    expect(signal.tableContentHashes.marker).toMatch(/^[0-9a-f]{64}$/)
    expect(rowStatement.iterate).toHaveBeenCalledOnce()
    expect(rowStatement.all).not.toHaveBeenCalled()
  })
})
