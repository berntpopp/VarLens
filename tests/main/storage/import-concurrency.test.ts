import { describe, expect, it } from 'vitest'

import { resolveImportConcurrency } from '../../../src/main/storage/import-concurrency'

describe('resolveImportConcurrency', () => {
  it('defaults to half the cores, capped at four', () => {
    expect(resolveImportConcurrency(undefined, 32)).toBe(4)
    expect(resolveImportConcurrency(undefined, 6)).toBe(3)
    expect(resolveImportConcurrency('', 8)).toBe(4)
  })

  it('never goes below one worker', () => {
    expect(resolveImportConcurrency(undefined, 1)).toBe(1)
    expect(resolveImportConcurrency('0', 16)).toBe(1)
    expect(resolveImportConcurrency('-3', 16)).toBe(1)
  })

  it('honours an explicit setting within 1..8', () => {
    expect(resolveImportConcurrency('1', 32)).toBe(1)
    expect(resolveImportConcurrency('6', 32)).toBe(6)
    expect(resolveImportConcurrency('64', 32)).toBe(8)
  })

  it('falls back to the default for a value that is not a whole number', () => {
    expect(resolveImportConcurrency('many', 32)).toBe(4)
    expect(resolveImportConcurrency('2.5', 32)).toBe(4)
  })
})
