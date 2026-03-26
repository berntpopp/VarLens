import { describe, it, expect } from 'vitest'
import { sqlPlaceholders } from '../../../src/main/database/sql-utils'

describe('sqlPlaceholders', () => {
  it('generates comma-separated placeholders for given count', () => {
    expect(sqlPlaceholders(3)).toBe('?, ?, ?')
  })

  it('returns single placeholder for count 1', () => {
    expect(sqlPlaceholders(1)).toBe('?')
  })

  it('returns empty string for count 0', () => {
    expect(sqlPlaceholders(0)).toBe('')
  })
})
