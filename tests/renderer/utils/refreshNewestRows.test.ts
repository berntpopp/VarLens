import { describe, expect, it } from 'vitest'
import { refreshNewestRows } from '../../../src/renderer/src/utils/refreshNewestRows'

interface Row {
  id: number
}

const PAGE_SIZE = 50

/** A newest-first server list served in pages, as `cases.query` does. */
function server(ids: number[]): {
  ids: number[]
  calls: number[]
  fetchPage: (offset: number) => Promise<{ data: Row[]; total_count: number }>
} {
  const state = {
    ids,
    calls: [] as number[],
    fetchPage: async (offset: number) => {
      state.calls.push(offset)
      return {
        data: state.ids.slice(offset, offset + PAGE_SIZE).map((id) => ({ id })),
        // Like the case list: only the first page carries the count.
        total_count: offset === 0 ? state.ids.length : 0
      }
    }
  }
  return state
}

const descending = (from: number, to: number): number[] =>
  Array.from({ length: from - to + 1 }, (_, index) => from - index)

const refresh = (
  existing: Row[],
  previousTotal: number,
  list: ReturnType<typeof server>
): ReturnType<typeof refreshNewestRows<Row>> =>
  refreshNewestRows({ existing, previousTotal, pageSize: PAGE_SIZE, fetchPage: list.fetchPage })

describe('refreshNewestRows', () => {
  it('fetches one page when at most one page of rows was added', async () => {
    const list = server(descending(60, 1))
    const existing = descending(50, 1).map((id) => ({ id }))
    const result = await refresh(existing, 50, list)
    expect(list.calls).toEqual([0])
    expect(result.rows.map((row) => row.id)).toEqual(descending(60, 1))
    expect(result.total).toBe(60)
  })

  it('misses no row when more than one page finished between two refreshes', async () => {
    // 10 cases on screen, then 120 more finish before the next refresh.
    const list = server(descending(130, 1))
    const existing = descending(10, 1).map((id) => ({ id }))
    const result = await refresh(existing, 10, list)

    expect(result.rows.map((row) => row.id)).toEqual(descending(130, 1))
    expect(result.total).toBe(130)
    // Three pages reach the newest row that was already loaded.
    expect(list.calls).toEqual([0, 50, 100])
  })

  it('finds a case that became visible below newer ones (parallel imports publish out of order)', async () => {
    // Loaded: the newest 50 of 200. Then 60 more appear on top and one case
    // created earlier (id 175.5 → 1000) becomes visible inside the loaded window.
    const before = descending(200, 1)
    const existing = before.slice(0, 50).map((id) => ({ id }))
    const after = [...descending(260, 201), ...before.slice(0, 25), 1000, ...before.slice(25)]
    const list = server(after)
    const result = await refresh(existing, 200, list)

    const ids = result.rows.map((row) => row.id)
    expect(ids).toEqual(after.slice(0, 111))
    expect(new Set(ids).size).toBe(ids.length)
    expect(result.total).toBe(261)
  })

  it('keeps rows loaded by later pages and returns a gap-free prefix of the server list', async () => {
    const list = server(descending(300, 1))
    // 150 rows loaded by scrolling, then 70 added.
    const existing = descending(230, 81).map((id) => ({ id }))
    const result = await refresh(existing, 230, list)
    expect(result.rows.map((row) => row.id)).toEqual(descending(300, 81))
  })

  it('stops paging at the loaded window when added rows lie beyond it', async () => {
    // The total grew by 60, but the list filter order puts nothing new on top.
    const before = descending(100, 1)
    const list = server([...before, ...descending(1060, 1001)])
    const existing = before.slice(0, 50).map((id) => ({ id }))
    const result = await refresh(existing, 100, list)
    expect(list.calls).toEqual([0])
    expect(result.rows.map((row) => row.id)).toEqual(before.slice(0, 50))
    expect(result.total).toBe(160)
  })

  it('does not duplicate a row that shifts between two page requests', async () => {
    const list = server(descending(120, 1))
    const original = list.fetchPage
    list.fetchPage = async (offset) => {
      const page = await original(offset)
      // A case finishes while the refresh is paging: every row shifts by one.
      if (offset === 0) list.ids = [121, ...list.ids]
      return page
    }
    const result = await refresh([{ id: 1 }], 1, list)
    const ids = result.rows.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(descending(120, 1))
  })

  it('leaves no gap and no deleted row when cases are deleted while others are added', async () => {
    // 50 of 100 loaded. Then 60 are added and 20 deleted (10 of them on screen):
    // the total grew by 40 only, which says nothing about how far to page.
    const before = descending(100, 1)
    const existing = before.slice(0, 50).map((id) => ({ id }))
    const after = [...descending(160, 101), ...descending(90, 21), ...descending(10, 1)]
    const list = server(after)
    const result = await refresh(existing, 100, list)

    const ids = result.rows.map((row) => row.id)
    // A gap-free prefix of the server list: the offset of the next page is right.
    expect(ids).toEqual(after.slice(0, ids.length))
    expect(ids.slice(0, 60)).toEqual(descending(160, 101))
    expect(ids).not.toContain(95)
    expect(ids).toContain(51)
    expect(result.total).toBe(140)
  })

  it('does not page through the whole list when nothing was loaded before', async () => {
    const list = server(descending(500, 1))
    const result = await refresh([], 0, list)
    expect(list.calls).toEqual([0])
    expect(result.rows).toHaveLength(50)
  })

  it('handles an empty server list', async () => {
    const result = await refresh([{ id: 1 }], 1, server([]))
    expect(result).toEqual({ rows: [{ id: 1 }], total: 0 })
  })
})
