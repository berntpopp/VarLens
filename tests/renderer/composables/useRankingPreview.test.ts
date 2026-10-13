import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { ShortlistConfig, ShortlistRow } from '../../../src/shared/types/shortlist'

const shortlist = vi.fn()
vi.mock('../../../src/renderer/src/composables/useApiService', () => ({
  useApiService: () => ({ api: { variants: { shortlist } } })
}))

import {
  rankDeltas,
  useRankingPreview
} from '../../../src/renderer/src/composables/useRankingPreview'

const row = (id: number, rank: number, score = 1): ShortlistRow =>
  ({
    id,
    rank,
    rank_score: score,
    gene_symbol: `G${id}`,
    chr: '1',
    pos: id,
    ref: 'A',
    alt: 'T'
  }) as ShortlistRow

describe('rankDeltas', () => {
  it('reports moves against the saved ranking and marks new rows', () => {
    const draft = [row(3, 1), row(1, 2), row(9, 3)]
    const saved = [row(1, 1), row(2, 2), row(3, 5)]
    expect(rankDeltas(draft, saved, 10).map((r) => r.delta)).toEqual([4, -1, null])
    expect(rankDeltas(draft, saved, 2)).toHaveLength(2)
    expect(rankDeltas(draft, null, 10)[0]).toMatchObject({
      delta: null,
      gene: 'G3',
      variant: '1:3 A>T'
    })
  })
})

describe('useRankingPreview', () => {
  const config = { topN: 5 } as ShortlistConfig
  beforeEach(() => shortlist.mockReset())

  it('ranks the draft ad hoc and the saved preset by id, then compares', async () => {
    shortlist
      .mockResolvedValueOnce({ rows: [row(2, 1), row(1, 2)] })
      .mockResolvedValueOnce({ rows: [row(1, 1), row(2, 2)] })
    const cfg = ref(config)
    const p = useRankingPreview(
      ref(7),
      () => cfg.value,
      () => 4,
      10
    )
    await p.run()
    expect(shortlist).toHaveBeenCalledWith({ caseId: 7, adHocConfig: config })
    expect(shortlist).toHaveBeenCalledWith({ caseId: 7, presetId: 4 })
    expect(p.result.value?.map((r) => r.delta)).toEqual([1, -1])
    expect(p.compared.value).toBe(true)
    expect(p.stale.value).toBe(false)
    cfg.value = { ...config, topN: 6 }
    expect(p.stale.value).toBe(true)
  })

  it('does nothing without an open case and skips the comparison for a new draft', async () => {
    await useRankingPreview(
      ref(null),
      () => config,
      () => null,
      10
    ).run()
    expect(shortlist).not.toHaveBeenCalled()
    shortlist.mockResolvedValueOnce({ rows: [row(1, 1)] })
    const p = useRankingPreview(
      ref(1),
      () => config,
      () => null,
      10
    )
    await p.run()
    expect(shortlist).toHaveBeenCalledTimes(1)
    expect(p.compared.value).toBe(false)
  })

  it('marks a result stale when the draft changed while its request was running', async () => {
    let resolve: (v: unknown) => void = () => undefined
    shortlist.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const cfg = ref<ShortlistConfig>({ ...config })
    const p = useRankingPreview(
      ref(1),
      () => cfg.value,
      () => null,
      10
    )
    const running = p.run()
    cfg.value.topN = 9 // edit the draft in place during the request
    resolve({ rows: [row(1, 1)] })
    await running
    expect(shortlist).toHaveBeenCalledWith({ caseId: 1, adHocConfig: config })
    expect(p.result.value).toHaveLength(1)
    expect(p.stale.value).toBe(true)
  })

  it('shows the error of a failed run', async () => {
    shortlist.mockRejectedValueOnce(new Error('boom'))
    const p = useRankingPreview(
      ref(1),
      () => config,
      () => null,
      10
    )
    await p.run()
    expect(p.error.value).toMatch(/boom/)
    expect(p.result.value).toBeNull()
  })
})
