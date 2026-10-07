import { describe, expect, it } from 'vitest'
import { mergeFirstPage } from '../../../src/renderer/src/utils/mergeFirstPage'

const row = (id: number, name = `case-${id}`): { id: number; name: string } => ({ id, name })

describe('mergeFirstPage', () => {
  it('puts new rows first and keeps the rows that were already loaded', () => {
    const existing = [row(3), row(2), row(1)]
    const merged = mergeFirstPage(existing, [row(5), row(4), row(3), row(2)])
    expect(merged.map((r) => r.id)).toEqual([5, 4, 3, 2, 1])
  })

  it('never duplicates a row and takes the fresh copy of a reloaded one', () => {
    const merged = mergeFirstPage([row(2, 'old'), row(1)], [row(2, 'renamed'), row(1)])
    expect(merged).toEqual([row(2, 'renamed'), row(1)])
  })

  it('keeps rows loaded by later pages below the refreshed first page', () => {
    const existing = [row(4), row(3), row(2), row(1)]
    const merged = mergeFirstPage(existing, [row(5), row(4)])
    expect(merged.map((r) => r.id)).toEqual([5, 4, 3, 2, 1])
    // Next infinite-scroll page starts after everything on screen.
    expect(merged.length).toBe(5)
  })

  it('fills an empty list and leaves the inputs untouched', () => {
    const existing: Array<{ id: number; name: string }> = []
    const firstPage = [row(1)]
    expect(mergeFirstPage(existing, firstPage)).toEqual([row(1)])
    expect(existing).toEqual([])
    expect(firstPage).toEqual([row(1)])
  })
})
