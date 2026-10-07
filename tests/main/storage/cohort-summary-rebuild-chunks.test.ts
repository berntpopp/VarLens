/**
 * The full rebuild of the cohort summary runs in key-range chunks (#469
 * review, item 5): no statement grows with the whole cohort.
 */
import { describe, expect, it } from 'vitest'

import { planRebuildChunks } from '../../../src/main/storage/postgres/cohort-summary-rebuild-chunks'

describe('planRebuildChunks', () => {
  const ranges = [
    { chr: '1', minPos: 1, maxPos: 1000 },
    { chr: '2', minPos: 501, maxPos: 1000 },
    { chr: 'X', minPos: 7, maxPos: 7 }
  ]

  it('keeps one chunk per chromosome for a small cohort', () => {
    expect(planRebuildChunks(ranges, 1000, 500_000)).toEqual([
      { chr: '1', fromPos: 1, toPos: 1001 },
      { chr: '2', fromPos: 501, toPos: 1001 },
      { chr: 'X', fromPos: 7, toPos: 8 }
    ])
  })

  it('splits by position so a chunk holds about the wanted number of rows', () => {
    // 1,501 positions and 6,000 rows at 1,000 per chunk: six chunks wanted, 251 wide.
    const chunks = planRebuildChunks(ranges, 6000, 1000)
    expect(chunks.map((chunk) => `${chunk.chr}:${chunk.fromPos}-${chunk.toPos}`)).toEqual([
      '1:1-252',
      '1:252-503',
      '1:503-754',
      '1:754-1001',
      '2:501-752',
      '2:752-1001',
      'X:7-8'
    ])
  })

  it('covers every position exactly once', () => {
    for (const rowsPerChunk of [1, 7, 333, 10_000]) {
      const chunks = planRebuildChunks(ranges, 5000, rowsPerChunk)
      for (const range of ranges) {
        const own = chunks.filter((chunk) => chunk.chr === range.chr)
        expect(own[0].fromPos).toBe(range.minPos)
        expect(own.at(-1)?.toPos).toBe(range.maxPos + 1)
        own.slice(1).forEach((chunk, index) => expect(chunk.fromPos).toBe(own[index].toPos))
      }
    }
  })

  it('plans nothing for an empty cohort', () => {
    expect(planRebuildChunks([], 0)).toEqual([])
  })
})
