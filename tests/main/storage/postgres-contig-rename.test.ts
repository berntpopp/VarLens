import { describe, expect, it } from 'vitest'

import { activeRenames } from '../../../src/main/storage/postgres/postgres-contig-rename'

const pair = (from: string, to: string) => [{ from, to }]

describe('activeRenames', () => {
  it('only the case itself when nobody else gives up a key it takes', () => {
    const active = activeRenames(
      1,
      pair('1', 'chr1'),
      [
        { caseId: 1, chr: '1' },
        { caseId: 2, chr: 'chr1' }
      ],
      new Map()
    )
    expect([...active.keys()]).toEqual([1])
  })

  it('a queued swap partner moves now', () => {
    const active = activeRenames(
      1,
      pair('1', 'chr1'),
      [
        { caseId: 1, chr: '1' },
        { caseId: 3, chr: 'chr1' }
      ],
      new Map([[3, pair('chr1', '1')]])
    )
    expect([...active.keys()].sort()).toEqual([1, 3])
  })

  it('a queued case that keeps its key or takes no new key stays', () => {
    const active = activeRenames(
      1,
      pair('1', 'chr1'),
      [
        { caseId: 1, chr: '1' },
        { caseId: 4, chr: 'MT' }
      ],
      new Map([[4, pair('MT', 'chrM')]])
    )
    expect([...active.keys()]).toEqual([1])
  })
})
